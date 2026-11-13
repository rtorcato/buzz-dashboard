import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatAge } from "./age";
import type { GitHub, GitHubItem } from "./github";
import {
  configFailures,
  countsByView,
  excludedLabels,
  failingRow,
  getNeedsYou,
  mergeRow,
  type NeedsYouRow,
  needsYouRefs,
  oldestFirst,
  pausedRow,
} from "./needs-you";
import type { StatusFeed } from "./status-feed";

vi.mock("next/server", () => ({ connection: async () => {} }));
const loadHive = vi.hoisted(() => vi.fn());
vi.mock("./hive", () => ({ loadHive }));
const loadStatusFeed = vi.hoisted(() =>
  vi.fn(async () => ({ feed: null as StatusFeed | null, stale: false })),
);
vi.mock("./status-feed", () => ({ loadStatusFeed }));
const loadGitHub = vi.hoisted(() => vi.fn());
vi.mock("./github", () => ({ loadGitHub }));
const loadFailing = vi.hoisted(() => vi.fn(async () => null));
vi.mock("./health-data", () => ({ loadFailing }));

const T = (iso: string) => Date.parse(iso) / 1000;
const feed = (usage: StatusFeed["usage"]): StatusFeed => ({
  publishedAt: T("2026-10-16T20:00:00Z"),
  runtime: {},
  usage,
});
const paused = feed({
  fiveH: 78,
  sevenD: 61,
  paused: true,
  fiveHResetsAt: T("2026-10-16T21:00:00Z"),
  sevenDResetsAt: T("2026-10-18T12:00:00Z"),
  fiveHPauseAt: 75,
  sevenDPauseAt: 90,
});

const pr = (over: Partial<GitHubItem>): GitHubItem => ({
  repo: "rtorcato/js-common",
  number: 1,
  title: "",
  url: "",
  isPr: true,
  labels: ["merge-ready"],
  agent: null,
  author: "rtorcato-bot",
  createdAt: T("2026-10-16T12:00:00Z"),
  closedAt: null,
  mergedAt: null,
  reviews: [],
  labelEvents: [],
  ...over,
});
const github = (prs: GitHubItem[]): GitHub => ({
  claims: [],
  prs,
  releases: [],
  truncated: false,
});

const row = (
  kind: NeedsYouRow["kind"],
  count: number,
  since: string,
): NeedsYouRow => ({
  kind,
  title: kind,
  detail: "",
  count,
  since,
});

describe("needs-you", () => {
  const rows = [
    row("blocked", 3, "2026-10-07T12:00:00Z"),
    row("release", 2, "2026-10-07T10:00:00Z"),
    row("ci", 1, "2026-10-07T11:00:00Z"),
  ];

  it("sorts oldest first", () => {
    expect(oldestFirst(rows).map((r) => r.kind)).toEqual([
      "release",
      "ci",
      "blocked",
    ]);
  });

  it("counts items per owning tab", () => {
    expect(countsByView(rows)).toEqual({ releases: 3, pipeline: 3 });
    expect(countsByView([])).toEqual({});
  });
});

describe("pausedRow", () => {
  const now = T("2026-10-16T20:05:00Z");
  it("names the tripped limit and links to Agents", () => {
    expect(pausedRow(paused, now)).toEqual({
      kind: "paused",
      title: "Paused for usage",
      detail: "5h window at 78% (pauses at 75%)",
      count: 1,
      since: "2026-10-16T20:00:00.000Z",
      resetsAt: T("2026-10-16T21:00:00Z"),
    });
    expect(countsByView([pausedRow(paused, now) as NeedsYouRow])).toEqual({
      agents: 1,
    });
  });
  it("is absent when not paused, not reported, or past the reset", () => {
    expect(pausedRow(null, now)).toBeNull();
    expect(pausedRow(feed(null), now)).toBeNull();
    expect(
      pausedRow(
        feed({
          ...(paused.usage as NonNullable<StatusFeed["usage"]>),
          paused: false,
        }),
        now,
      ),
    ).toBeNull();
    expect(pausedRow(paused, T("2026-10-16T21:00:00Z"))).toBeNull();
  });
});

describe("mergeRow", () => {
  it("lists open merge-ready PRs, oldest first", () => {
    expect(
      mergeRow(
        github([
          pr({ number: 2 }),
          pr({
            repo: "rtorcato/db-common",
            number: 7,
            createdAt: T("2026-10-15T00:00:00Z"),
          }),
          pr({ number: 3, labels: ["ai-review"] }),
          pr({ number: 4, closedAt: T("2026-10-16T13:00:00Z") }),
        ]),
      ),
    ).toEqual({
      kind: "merge",
      title: "2 PRs ready to merge",
      detail: "js-common#2, db-common#7",
      count: 2,
      since: "2026-10-15T00:00:00.000Z",
      keys: ["merge:rtorcato/js-common#2", "merge:rtorcato/db-common#7"],
    });
  });
  it("is absent with none", () => {
    expect(mergeRow(github([pr({ labels: [] })]))).toBeNull();
  });
});

describe("excludedLabels", () => {
  it("splits a comma list", () => {
    expect([...excludedLabels(" merge-ready, ai-blocked ,")]).toEqual([
      "merge-ready",
      "ai-blocked",
    ]);
    expect(excludedLabels(undefined).size).toBe(0);
  });
});

describe("getNeedsYou", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_TOKEN", "");
    vi.stubEnv("NEEDS_YOU_EXCLUDE_LABELS", "");
    vi.stubEnv("BUZZ_RELAY_URL", "");
  });
  const relayEnv = () => {
    vi.stubEnv("BUZZ_RELAY_URL", "wss://relay.example");
    vi.stubEnv("BUZZ_PRIVATE_KEY", "a".repeat(64));
  };
  afterEach(() => {
    vi.unstubAllEnvs();
    loadHive.mockReset();
    loadGitHub.mockReset();
  });

  it("lists merge-ready PRs by default", async () => {
    vi.stubEnv("GITHUB_TOKEN", "gh");
    loadGitHub.mockResolvedValue({ github: github([pr({})]), fetchedAt: "" });
    const data = await getNeedsYou();
    expect(data.rows.map((r) => r.kind)).toEqual(["merge"]);
  });

  it("hides merge-ready when NEEDS_YOU_EXCLUDE_LABELS names it", async () => {
    vi.stubEnv("GITHUB_TOKEN", "gh");
    vi.stubEnv("NEEDS_YOU_EXCLUDE_LABELS", "merge-ready");
    const data = await getNeedsYou();
    expect(data.rows).toEqual([]);
    expect(loadGitHub).not.toHaveBeenCalled();
  });

  it("names GitHub when its read fails", async () => {
    vi.stubEnv("GITHUB_TOKEN", "gh");
    loadGitHub.mockResolvedValue({ github: null, error: "HTTP 502" });
    const data = await getNeedsYou();
    expect(data.failures).toContainEqual({
      source: "GitHub",
      detail: "HTTP 502, so merge-ready PRs can't load.",
    });
  });

  it("doesn't wait on a cold GitHub read", async () => {
    vi.stubEnv("GITHUB_TOKEN", "gh");
    vi.useFakeTimers();
    loadGitHub.mockReturnValue(new Promise(() => {}));
    const pending = getNeedsYou();
    await vi.advanceTimersByTimeAsync(2_000);
    const data = await pending;
    vi.useRealTimers();
    expect(data.rows).toEqual([]);
    expect(data.failures.map((f) => f.source)).not.toContain("GitHub");
  });

  it("is not connected, with no freshness, until a source exists", async () => {
    vi.stubEnv("BUZZ_RELAY_URL", "");
    const data = await getNeedsYou();
    expect(data.connected).toBe(false);
    expect(data.updatedAt).toBeNull();
    expect(data.rows).toEqual([]);
    expect(loadHive).not.toHaveBeenCalled();
  });

  it("lists a usage pause even while the other sources are disconnected", async () => {
    vi.stubEnv("BUZZ_RELAY_URL", "");
    vi.useFakeTimers({ now: Date.parse("2026-10-16T20:05:00Z") });
    loadStatusFeed.mockResolvedValueOnce({ feed: paused, stale: false });
    const data = await getNeedsYou();
    vi.useRealTimers();
    expect(data.connected).toBe(false);
    expect(data.rows.map((r) => r.kind)).toEqual(["paused"]);
  });

  it("takes freshness from a successful relay fetch", async () => {
    relayEnv();
    loadHive.mockResolvedValue({ hive: {}, fetchedAt: "2026-10-09T18:00:00Z" });
    const data = await getNeedsYou();
    expect(data.updatedAt).toBe("2026-10-09T18:00:00Z");
    expect(data.failures.map((f) => f.source)).not.toContain("the Buzz relay");
  });

  it("names the relay when its fetch fails, and keeps freshness empty", async () => {
    relayEnv();
    loadHive.mockResolvedValue({ hive: null, error: "Buzz relay timed out" });
    const data = await getNeedsYou();
    expect(data.updatedAt).toBeNull();
    expect(data.failures).toContainEqual({
      source: "the Buzz relay",
      detail: "Buzz relay timed out, so Agents and Timeline can't load.",
    });
  });
});

describe("configFailures", () => {
  const key = "a".repeat(64);
  const ok = {
    BUZZ_RELAY_URL: "wss://relay.example",
    BUZZ_PRIVATE_KEY: key,
    GITHUB_TOKEN: "gh",
  };

  it("is empty when every source is configured", () => {
    expect(configFailures(ok)).toEqual([]);
  });

  it("names the relay when BUZZ_* is missing", () => {
    const [f] = configFailures({
      ...ok,
      BUZZ_RELAY_URL: "",
      BUZZ_PRIVATE_KEY: undefined,
    });
    expect(f.source).toBe("the Buzz relay");
    expect(f.detail).toContain(
      "BUZZ_RELAY_URL and BUZZ_PRIVATE_KEY are not set",
    );
  });

  it("names the relay when the key is not 64-char hex", () => {
    expect(configFailures({ ...ok, BUZZ_PRIVATE_KEY: "nsec1abc" })).toEqual([
      expect.objectContaining({ source: "the Buzz relay" }),
    ]);
  });

  it("names GitHub when GITHUB_TOKEN is missing", () => {
    expect(configFailures({ ...ok, GITHUB_TOKEN: "" })).toEqual([
      expect.objectContaining({ source: "GitHub" }),
    ]);
  });
});

describe("formatAge", () => {
  it.each([
    [-5_000, "0s"],
    [14_000, "14s"],
    [7 * 60_000, "7m"],
    [2 * 3_600_000, "2h"],
    [(2 * 60 + 14) * 60_000, "2h 14m"],
    [50 * 3_600_000, "2d"],
  ])("%i ms -> %s", (ms, out) => {
    expect(formatAge(ms)).toBe(out);
  });
});

describe("failingRow", () => {
  const f = {
    agent: "Gale",
    hour: { attempts: 14, errors: 6, cancelled: 0, maxTokens: 0 },
    since: T("2026-10-16T19:08:00Z"),
  };

  it("says turns for per-turn reports", () => {
    expect(failingRow(f, "signer")).toEqual({
      kind: "failing",
      title: "Gale is failing turns",
      detail: "6 of 14 turns ended in error in the last hour",
      count: 1,
      since: "2026-10-16T19:08:00.000Z",
      keys: ["failing:Gale"],
    });
  });

  it("says API requests, never turns, for OpenTelemetry", () => {
    const row = failingRow(f, "otel");
    expect(row.title).toBe("Gale is failing API requests");
    expect(row.detail).toBe("6 of 14 API requests failed in the last hour");
  });

  it("counts toward Health in the sidebar", () => {
    expect(
      countsByView([failingRow(f, "otel"), failingRow(f, "otel")]),
    ).toEqual({
      health: 2,
    });
  });
});

describe("needsYouRefs", () => {
  it("keeps only GitHub item refs", () => {
    const refs = needsYouRefs({
      connected: true,
      rows: [
        { keys: ["merge:rtorcato/js-common#2", "failing:Gale"] },
        { keys: undefined },
      ] as NeedsYouRow[],
      headsUp: [],
      failures: [],
      updatedAt: null,
    });
    expect([...refs]).toEqual(["rtorcato/js-common#2"]);
  });
});
