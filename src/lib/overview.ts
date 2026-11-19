import { cacheHit, modelTiers, type Tier, tierNames } from "./cost";
import { CLAIM_LABELS, type Claim } from "./github";
import { type HealthBucket, SLOT_S } from "./health";
import type { CostRow } from "./history";
import { OVERVIEW_RANGES, type OverviewRange } from "./overview-range";

// DESIGN.md → Obsidian redesign → Overview. Times are unix seconds, and day
// and hour buckets follow the server clock, like "Today" on the other views.

export {
  DEFAULT_OVERVIEW_RANGE,
  greeting,
  OVERVIEW_RANGES,
  type OverviewRange,
  parseRange,
  rangesFor,
} from "./overview-range";

export type Buckets = {
  /** Bucket starts, oldest first. The last bucket runs to now. */
  starts: number[];
  /** "hour" at 24h, "day" otherwise. */
  unit: "hour" | "day";
};

/** Hourly buckets over the last 24 hours, or local days over the range. */
export function bucketsFor(range: OverviewRange, now: Date): Buckets {
  if (range === "24h") {
    const h = new Date(now);
    h.setMinutes(0, 0, 0);
    const top = h.getTime() / 1000;
    return {
      unit: "hour",
      starts: Array.from({ length: 24 }, (_, i) => top - (23 - i) * 3600),
    };
  }
  const days = OVERVIEW_RANGES[range];
  return {
    unit: "day",
    starts: Array.from({ length: days }, (_, i) => {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - (days - 1 - i));
      return d.getTime() / 1000;
    }),
  };
}

/** The index of the bucket holding `at`, or -1 before the first. */
function bucketOf(starts: number[], at: number): number {
  for (let i = starts.length - 1; i >= 0; i--) if (at >= starts[i]) return i;
  return -1;
}

/** How many of `times` fall in each bucket. */
export function countInto(starts: number[], times: number[]): number[] {
  const out = starts.map(() => 0);
  for (const t of times) {
    const i = bucketOf(starts, t);
    if (i >= 0) out[i]++;
  }
  return out;
}

/** Sum `points` (at, value) into each bucket. */
export function sumInto(
  starts: number[],
  points: { at: number; value: number }[],
): number[] {
  const out = starts.map(() => 0);
  for (const p of points) {
    const i = bucketOf(starts, p.at);
    if (i >= 0) out[i] += p.value;
  }
  return out;
}

/** Percent change against the previous period, or null when it can't be said. */
export function delta(cur: number, prev: number | null): number | null {
  if (prev === null || prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

/** Turns and errors per bucket from Health's 15-minute buckets. */
export function turnSeries(
  buckets: HealthBucket[],
  starts: number[],
): { turns: number[]; errors: number[] } {
  const turns = starts.map(() => 0);
  const errors = starts.map(() => 0);
  for (const b of buckets) {
    // A slot counts in the bucket its middle falls in.
    const i = bucketOf(starts, b.slot + SLOT_S / 2);
    if (i < 0) continue;
    turns[i] += b.count;
    if (b.kind === "error" || b.reason === "error") errors[i] += b.count;
  }
  return { turns, errors };
}

/** Pipeline Now stages from the claim labels: one count per label, in order. */
export function stageCounts(
  claims: Pick<Claim, "labels">[],
): { label: string; count: number }[] {
  return CLAIM_LABELS.map((label) => ({
    label,
    count: claims.filter((c) => c.labels.includes(label)).length,
  }));
}

export type Spend = {
  /** Estimated dollars per tier: index 0 is --model-1. */
  byTier: [number, number, number];
  /** The models in each tier, short names. */
  names: [string, string, string];
  total: number;
  tokens: number;
  cacheHit: number | null;
};

/** Spend by model over the cost rows of the range. */
export function spendByModel(rows: CostRow[]): Spend {
  const tiers = modelTiers(rows);
  const byTier: [number, number, number] = [0, 0, 0];
  let tokens = 0;
  const cache = { input: 0, cacheRead: 0, cacheCreation: 0 };
  for (const r of rows) {
    const t = tiers.get(r.model) as Tier;
    if (r.metric === "cost") {
      byTier[t] += r.value;
      continue;
    }
    tokens += r.value;
    if (r.type === "input") cache.input += r.value;
    if (r.type === "cacheRead") cache.cacheRead += r.value;
    if (r.type === "cacheCreation") cache.cacheCreation += r.value;
  }
  return {
    byTier,
    names: tierNames(tiers),
    total: byTier[0] + byTier[1] + byTier[2],
    tokens,
    cacheHit: cacheHit({
      cost: [0, 0, 0],
      tokens: [0, 0, 0],
      ...cache,
    }),
  };
}

/** Messages by weekday (0 = Sunday) and local hour, 7 × 24. */
export function weekHourGrid(times: number[], weeks = 1): number[][] {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const t of times) {
    const d = new Date(t * 1000);
    grid[d.getDay()][d.getHours()]++;
  }
  if (weeks <= 1) return grid;
  return grid.map((row) => row.map((n) => Math.round((n / weeks) * 10) / 10));
}

/** The busiest weekday and hour, or null with no messages. */
export function peakCell(
  grid: number[][],
): { day: number; hour: number; count: number } | null {
  let best: { day: number; hour: number; count: number } | null = null;
  for (let day = 0; day < grid.length; day++) {
    for (let hour = 0; hour < grid[day].length; hour++) {
      const count = grid[day][hour];
      if (count > 0 && (!best || count > best.count))
        best = { day, hour, count };
    }
  }
  return best;
}

/** One of 5 heat steps (1 to 5) for a cell, or 0 when empty. */
export function heatStep(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(5, Math.max(1, Math.ceil((count / max) * 5)));
}
