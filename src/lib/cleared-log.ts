import type { Item, Mutes } from "./alerts";

// The Needs you cleared-items log (#88): pure parts. The alerts pass diffs the
// items showing now against the open log rows; history.ts stores the result.

export type OpenRow = { key: string; appearedAt: number; acked: boolean };

export type LogRow = {
  key: string;
  rule: string;
  title: string;
  appearedAt: number;
  clearedAt: number;
  acked: boolean;
};

/**
 * What changed since the last pass. `appeared` are items with no open row,
 * `cleared` are open rows whose item is gone, and `acked` are open rows the
 * owner has acked (snoozed until it changes) since the last pass. A rule in
 * `down` (its source didn't answer) clears nothing, so an outage doesn't log
 * everything as cleared.
 */
export function diffLog(
  open: OpenRow[],
  items: Item[],
  mutes: Mutes,
  down: string[] = [],
): { appeared: Item[]; cleared: string[]; acked: string[] } {
  const showing = new Set(items.map((i) => i.key));
  const logged = new Set(open.map((r) => r.key));
  return {
    appeared: items.filter((i) => !logged.has(i.key)),
    cleared: open
      .filter((r) => !showing.has(r.key) && !down.includes(r.key.split(":")[0]))
      .map((r) => r.key),
    // Includes an item that cleared this pass, so a quick ack still counts.
    acked: open
      .filter((r) => !r.acked && mutes[r.key]?.until === null)
      .map((r) => r.key),
  };
}

/** How a row cleared, for the History table's "How" column. */
export function howCleared(rule: string, acked: boolean): string {
  if (rule === "merge") return "Merged";
  if (rule === "failing") return "Recovered";
  return acked ? "Approved by you" : "Cleared";
}

export type ClearedStats = { count: number; avgMs: number | null };

/** The footer's "N cleared · avg X to clear" over rows cleared since `since`. */
export function clearedStats(rows: LogRow[], since: number): ClearedStats {
  const recent = rows.filter((r) => r.clearedAt >= since);
  if (!recent.length) return { count: 0, avgMs: null };
  const total = recent.reduce((n, r) => n + (r.clearedAt - r.appearedAt), 0);
  return { count: recent.length, avgMs: total / recent.length };
}

/** Median time to clear per rule, for the History footer. */
export function medianByRule(rows: LogRow[]): Record<string, number> {
  const by: Record<string, number[]> = {};
  for (const r of rows) {
    by[r.rule] ??= [];
    by[r.rule].push(r.clearedAt - r.appearedAt);
  }
  return Object.fromEntries(
    Object.entries(by).map(([rule, ms]) => {
      ms.sort((a, b) => a - b);
      const mid = Math.floor(ms.length / 2);
      return [rule, ms.length % 2 ? ms[mid] : (ms[mid - 1] + ms[mid]) / 2];
    }),
  );
}
