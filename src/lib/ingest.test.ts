import { describe, expect, it, vi } from "vitest";
import type { GitHubItem } from "./github";
import type { NostrEvent } from "./relay";

vi.mock("server-only", () => ({}));

const { buzzRows, githubRows, pickFresh } = await import("./ingest");
const { retentionDays } = await import("./history");

const item = (over: Partial<GitHubItem> = {}): GitHubItem => ({
  repo: "acme/app",
  number: 7,
  title: "feat: thing",
  url: "https://github.com/acme/app/pull/7",
  isPr: true,
  labels: ["ai-review"],
  agent: "Shockwave",
  author: "acme-bot",
  createdAt: 1_700_000_000,
  closedAt: null,
  mergedAt: null,
  reviews: [],
  labelEvents: [],
  ...over,
});

describe("githubRows", () => {
  it("keys each PR transition and issue claim on a stable source id", () => {
    const rows = githubRows({
      prs: [
        item({
          mergedAt: 1_700_000_500,
          closedAt: 1_700_000_500,
          reviews: [{ state: "APPROVED", at: 1_700_000_300, author: "alice" }],
        }),
        item({ number: 8, agent: null, closedAt: 1_700_000_900 }),
      ],
      claims: [
        { ...item({ number: 3, isPr: false }), claimedAt: 1_700_000_100 },
        // A PR's claim is its opening, and an unattributed claim has no time.
        { ...item(), claimedAt: 1_700_000_000 },
        { ...item({ number: 4, isPr: false, agent: null }), claimedAt: 1 },
      ],
      releases: [],
      truncated: false,
    });
    expect(rows.map((r) => [r.sourceId, r.kind, r.actor])).toEqual([
      ["acme/app#7:opened", "pr_opened", "Shockwave"],
      ["acme/app#7:reviewed:1700000300:alice", "pr_reviewed", "alice"],
      ["acme/app#7:merged", "pr_merged", "Shockwave"],
      ["acme/app#8:opened", "pr_opened", "acme-bot"],
      ["acme/app#8:closed", "pr_closed", "acme-bot"],
      ["acme/app#3:claimed:1700000100", "claimed", "Shockwave"],
    ]);
    expect(rows[1].data).toMatchObject({
      state: "APPROVED",
      author: "acme-bot",
    });
    expect(rows[2].at).toEqual(new Date(1_700_000_500_000));
  });
});

describe("githubRows, labels and releases (#54)", () => {
  it("records each label change once and each published release", () => {
    const labelEvents = [
      {
        label: "ai-ready",
        action: "added" as const,
        at: 10,
        actor: "rtorcato",
      },
      { label: "ai-ready", action: "removed" as const, at: 20, actor: "bot" },
    ];
    const pr = item({ labelEvents });
    const rows = githubRows({
      // The same PR as a claim too: its label rows aren't doubled.
      prs: [pr],
      claims: [{ ...pr, claimedAt: 1 }],
      releases: [
        {
          repo: "acme/app",
          tag: "v1.2.0",
          name: "v1.2.0",
          url: "https://github.com/acme/app/releases/tag/v1.2.0",
          publishedAt: 30,
          author: "github-actions[bot]",
          prerelease: false,
        },
      ],
      truncated: false,
    });
    const extra = rows.filter((r) => r.kind !== "pr_opened");
    expect(extra.map((r) => [r.sourceId, r.kind, r.actor])).toEqual([
      ["acme/app#7:label:added:ai-ready:10", "labelled", "rtorcato"],
      ["acme/app#7:label:removed:ai-ready:20", "labelled", "bot"],
      ["acme/app@v1.2.0:released", "released", "github-actions[bot]"],
    ]);
    expect(extra[1].data).toEqual({
      number: 7,
      label: "ai-ready",
      action: "removed",
    });
    expect(extra[2]).toMatchObject({
      at: new Date(30_000),
      data: { tag: "v1.2.0", prerelease: false },
    });
  });
});

describe("buzzRows", () => {
  it("keeps channel messages only, keyed on the event id", () => {
    const ev = (kind: number, id: string): NostrEvent => ({
      id,
      kind,
      pubkey: "ab".repeat(32),
      created_at: 1_700_000_000,
      tags: [["h", "chan-1"]],
      content: "hello",
      sig: "",
    });
    expect(buzzRows([ev(9, "e1"), ev(0, "e2")])).toEqual([
      {
        source: "buzz",
        sourceId: "e1",
        kind: "message",
        at: new Date(1_700_000_000_000),
        actor: "ab".repeat(32),
        channel: "chan-1",
        body: "hello",
      },
    ]);
  });
});

describe("retentionDays", () => {
  it("defaults to 90 unless given a positive whole number", () => {
    expect(retentionDays(undefined)).toBe(90);
    expect(retentionDays("")).toBe(90);
    expect(retentionDays("0")).toBe(90);
    expect(retentionDays("7.5")).toBe(90);
    expect(retentionDays("30")).toBe(30);
  });
});

describe("pickFresh", () => {
  const ev = (id: string, created_at: number): NostrEvent => ({
    id,
    kind: 44200,
    pubkey: "ab".repeat(32),
    created_at,
    tags: [],
    content: "",
    sig: "",
  });

  it("skips stored and given-up reports, oldest first, up to the cap", () => {
    const turns = [ev("c", 3), ev("a", 1), ev("stored", 0), ev("bad", 2)];
    const tries = new Map([["bad", 3]]);
    expect(
      pickFresh(turns, new Set(["stored"]), tries).map((e) => e.id),
    ).toEqual(["a", "c"]);
    expect(pickFresh(turns, new Set(), new Map(), 2).map((e) => e.id)).toEqual([
      "stored",
      "a",
    ]);
  });

  it("retries a report that has failed fewer than three times", () => {
    expect(
      pickFresh([ev("x", 1)], new Set(), new Map([["x", 2]])),
    ).toHaveLength(1);
  });
});
