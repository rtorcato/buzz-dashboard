import { describe, expect, it, vi } from "vitest";
import type { CostRow } from "./history";

vi.mock("server-only", () => ({}));

const {
  bucketsFor,
  countInto,
  delta,
  greeting,
  heatStep,
  parseRange,
  peakCell,
  rangesFor,
  spendByModel,
  stageCounts,
  sumInto,
  turnSeries,
  weekHourGrid,
} = await import("./overview");

describe("ranges", () => {
  it("offers 30d and 90d only with the history store", () => {
    expect(rangesFor(false)).toEqual(["24h", "7d"]);
    expect(rangesFor(true)).toEqual(["24h", "7d", "30d", "90d"]);
  });

  it("falls back to 7d for a missing or unavailable range", () => {
    expect(parseRange(undefined, true)).toBe("7d");
    expect(parseRange("90d", false)).toBe("7d");
    expect(parseRange("90d", true)).toBe("90d");
    expect(parseRange("24h", false)).toBe("24h");
  });
});

describe("greeting", () => {
  it("follows the time of day", () => {
    expect(greeting(8)).toBe("Good morning");
    expect(greeting(14)).toBe("Good afternoon");
    expect(greeting(21)).toBe("Good evening");
    expect(greeting(2)).toBe("Good evening");
  });
});

describe("buckets", () => {
  const now = new Date(2026, 10, 19, 16, 30);

  it("makes 24 hourly buckets ending at the current hour", () => {
    const b = bucketsFor("24h", now);
    expect(b.unit).toBe("hour");
    expect(b.starts).toHaveLength(24);
    expect(b.starts[23]).toBe(new Date(2026, 10, 19, 16).getTime() / 1000);
    expect(b.starts[23] - b.starts[22]).toBe(3600);
  });

  it("makes one local day per day of the range", () => {
    const b = bucketsFor("7d", now);
    expect(b.unit).toBe("day");
    expect(b.starts).toHaveLength(7);
    expect(b.starts[6]).toBe(new Date(2026, 10, 19).getTime() / 1000);
    expect(b.starts[0]).toBe(new Date(2026, 10, 13).getTime() / 1000);
  });

  it("counts and sums into buckets, dropping times before the first", () => {
    const starts = [100, 200, 300];
    expect(countInto(starts, [50, 100, 250, 299, 999])).toEqual([1, 2, 1]);
    expect(
      sumInto(starts, [
        { at: 150, value: 2.5 },
        { at: 310, value: 1 },
        { at: 10, value: 9 },
      ]),
    ).toEqual([2.5, 0, 1]);
  });
});

describe("delta", () => {
  it("is a whole percent, or null without a previous value", () => {
    expect(delta(12, 10)).toBe(20);
    expect(delta(5, 10)).toBe(-50);
    expect(delta(5, 0)).toBeNull();
    expect(delta(5, null)).toBeNull();
  });
});

describe("turnSeries", () => {
  it("counts turns and errors per bucket", () => {
    const b = (
      slot: number,
      kind: string,
      reason: string | null,
      count: number,
    ) => ({
      agent: "A",
      slot,
      kind,
      reason,
      count,
      last: slot,
    });
    const s = turnSeries(
      [
        b(0, "turn", "end_turn", 4),
        b(0, "turn", "error", 1),
        b(3600, "error", null, 2),
      ],
      [0, 3600],
    );
    expect(s).toEqual({ turns: [5, 2], errors: [1, 2] });
  });
});

describe("stageCounts", () => {
  it("counts each claim label in pipeline order", () => {
    expect(
      stageCounts([
        { labels: ["ai-wip"] },
        { labels: ["ai-review"] },
        { labels: ["ai-review", "bug"] },
        { labels: ["ai-blocked"] },
      ]),
    ).toEqual([
      { label: "ai-wip", count: 1 },
      { label: "ai-review", count: 2 },
      { label: "ai-changes", count: 0 },
      { label: "ai-blocked", count: 1 },
    ]);
  });
});

describe("spendByModel", () => {
  const row = (
    model: string,
    metric: string,
    type: string,
    value: number,
  ): CostRow => ({
    day: new Date(0),
    agent: "A",
    model,
    metric,
    type,
    value,
  });

  it("splits cost by price tier and reads tokens and cache hit", () => {
    const s = spendByModel([
      row("claude-opus-4-5", "cost", "", 30),
      row("claude-opus-4-5", "tokens", "input", 100),
      row("claude-haiku-4-5", "cost", "", 1),
      row("claude-haiku-4-5", "tokens", "cacheRead", 300),
    ]);
    expect(s.total).toBe(31);
    expect(s.byTier[0]).toBe(30);
    expect(s.tokens).toBe(400);
    expect(s.cacheHit).toBe(0.75);
    expect(s.names[0]).toBe("opus-4-5");
  });
});

describe("heatmap", () => {
  it("bins by weekday and hour, and averages over weeks", () => {
    const tue14 = new Date(2026, 10, 17, 14, 5).getTime() / 1000;
    const grid = weekHourGrid([tue14, tue14 + 60, tue14 + 3600]);
    expect(grid[2][14]).toBe(2);
    expect(grid[2][15]).toBe(1);
    expect(weekHourGrid([tue14, tue14 + 60], 4)[2][14]).toBe(0.5);
    expect(peakCell(grid)).toEqual({ day: 2, hour: 14, count: 2 });
    expect(peakCell(weekHourGrid([]))).toBeNull();
  });

  it("steps a count into 5 shades, 0 for empty", () => {
    expect(heatStep(0, 10)).toBe(0);
    expect(heatStep(1, 10)).toBe(1);
    expect(heatStep(10, 10)).toBe(5);
    expect(heatStep(5, 10)).toBe(3);
  });
});
