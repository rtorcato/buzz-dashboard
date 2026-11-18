import { describe, expect, it } from "vitest";
import {
  buildHealth,
  failingAgents,
  type HealthBucket,
  type HealthInput,
  quietClaims,
  SLOT_S,
} from "./health";

const NOW = 1_792_800_000; // a slot boundary: 1_792_800_000 % 900 === 0
const slot = (ago: number) => NOW - ago * SLOT_S;
const turns = (
  agent: string,
  ago: number,
  count: number,
  reason: string | null = "end_turn",
): HealthBucket => ({
  agent,
  slot: slot(ago),
  kind: "turn",
  reason,
  count,
  last: slot(ago) + 60,
});

const input = (over: Partial<HealthInput>): HealthInput => ({
  agents: [],
  claims: [],
  buckets: [],
  now: NOW,
  rangeH: 24,
  ...over,
});

describe("failingAgents", () => {
  it("flags over 25% errors in the last 15 minutes", () => {
    const f = failingAgents(
      [turns("Gale", 1, 4), turns("Gale", 1, 3, "error"), turns("Fern", 1, 9)],
      NOW,
    );
    expect(f.map((a) => a.agent)).toEqual(["Gale"]);
    expect(f[0].hour).toMatchObject({ attempts: 7, errors: 3 });
  });

  it("needs a few attempts, so one failed request isn't failing", () => {
    expect(failingAgents([turns("Gale", 1, 1, "error")], NOW)).toEqual([]);
  });

  it("ignores errors older than the window", () => {
    expect(failingAgents([turns("Gale", 3, 5, "error")], NOW)).toEqual([]);
  });

  it("counts OTel api_error events against requests", () => {
    const b = (kind: string, count: number): HealthBucket => ({
      agent: "Gale",
      slot: slot(1),
      kind,
      reason: null,
      count,
      last: slot(1),
    });
    const [f] = failingAgents([b("request", 6), b("error", 4)], NOW);
    expect(f.hour).toMatchObject({ attempts: 10, errors: 4 });
  });

  it("dates the failure from the run of slots with errors", () => {
    const [f] = failingAgents(
      [
        turns("Gale", 5, 2, "error"),
        turns("Gale", 4, 3),
        turns("Gale", 3, 1, "error"),
        turns("Gale", 2, 1, "error"),
        turns("Gale", 1, 3, "error"),
      ],
      NOW,
    );
    expect(f.since).toBe(slot(3));
  });
});

describe("buildHealth", () => {
  const agent = (name: string, lastSeenAt: number | null = NOW - 60) => ({
    name,
    lastSeenAt,
  });

  it("sorts failing, silent, healthy, idle", () => {
    const h = buildHealth(
      input({
        agents: [
          agent("Idle", NOW - 5 * 3600),
          agent("Healthy"),
          agent("Silent", NOW - 6 * 3600),
          agent("Failing"),
        ],
        claims: [{ agent: "Silent", key: "cli#124", claimedAt: NOW - 86_400 }],
        buckets: [turns("Failing", 1, 4, "error"), turns("Healthy", 1, 9)],
      }),
    );
    expect(h.map((a) => [a.name, a.status])).toEqual([
      ["Failing", "failing"],
      ["Silent", "silent"],
      ["Healthy", "healthy"],
      ["Idle", "idle"],
    ]);
    expect(h[1].silentFor).toBe(6 * 3600);
    expect(h[1].claim).toEqual({
      key: "cli#124",
      claimedAt: NOW - 86_400,
      more: 0,
    });
  });

  it("counts silence from a newer claim, since claiming is a turn", () => {
    const [a] = buildHealth(
      input({
        agents: [agent("Fern", NOW - 10 * 3600)],
        claims: [{ agent: "Fern", key: "cli#1", claimedAt: NOW - 3600 }],
      }),
    );
    expect(a.status).toBe("healthy");
    expect(a.silentFor).toBeNull();
  });

  it("uses the status feed's last turn and presence", () => {
    const [a] = buildHealth(
      input({
        agents: [
          {
            ...agent("Fern", NOW - 10 * 3600),
            runtime: { state: "stopped", lastTurn: NOW - 120 },
          },
        ],
      }),
    );
    expect(a.lastTurn).toBe(NOW - 120);
    expect(a.online).toBe(false);
  });

  it("buckets the last 24 hours for the chart, oldest first", () => {
    const [a] = buildHealth(
      input({
        agents: [agent("Gale")],
        buckets: [
          turns("Gale", 1, 5),
          turns("Gale", 1, 2, "error"),
          turns("Gale", 200, 7),
        ],
      }),
    );
    expect(a.hourly).toHaveLength(24);
    // NOW is on the hour, so the 15 minutes before it are the previous hour.
    expect(a.hourly.at(-2)).toEqual({ ok: 5, errors: 2 });
    expect(a.hourly.reduce((n, h) => n + h.ok + h.errors, 0)).toBe(7);
  });

  it("tallies cancelled and max-tokens turns over the range", () => {
    const [a] = buildHealth(
      input({
        agents: [agent("Gale")],
        rangeH: 1,
        buckets: [
          turns("Gale", 1, 2, "cancelled"),
          turns("Gale", 2, 1, "max_tokens"),
          turns("Gale", 3, 1),
          turns("Gale", 10, 5, "cancelled"),
        ],
      }),
    );
    expect(a.range).toEqual({
      attempts: 4,
      errors: 0,
      cancelled: 2,
      maxTokens: 1,
    });
  });
});

describe("quietClaims", () => {
  const agent = (name: string, lastSeenAt: number | null) => ({
    name,
    lastSeenAt,
  });
  it("counts from the later of the last turn and the newest claim", () => {
    const q = quietClaims({
      agents: [agent("Fern", NOW - 5 * 3600), agent("Gale", NOW - 9 * 3600)],
      claims: [
        { agent: "Fern", key: "r#1", claimedAt: NOW - 8 * 3600 },
        { agent: "Fern", key: "r#2", claimedAt: NOW - 6 * 3600 },
        { agent: "Gale", key: "r#3", claimedAt: NOW - 2 * 3600 },
      ],
      buckets: [turns("Fern", 4, 2)],
    });
    // Quietest first.
    expect(q).toEqual([
      { agent: "Gale", since: NOW - 2 * 3600, key: "r#3", more: 0 },
      { agent: "Fern", since: slot(4) + 60, key: "r#1", more: 1 },
    ]);
  });
  it("leaves out agents without a claim", () => {
    expect(
      quietClaims({ agents: [agent("Fern", null)], claims: [], buckets: [] }),
    ).toEqual([]);
  });
});
