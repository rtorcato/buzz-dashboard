// The Needs you row shapes and their pure helpers. Client components read
// these (the card scopes rows to a project in the browser), so nothing here
// may import a server-only module; needs-you.ts re-exports all of it.

export const VIEWS = [
  "agents",
  "health",
  "pipeline",
  "releases",
  "timeline",
] as const;
export type View = (typeof VIEWS)[number];

// The things that need the owner. A deployment whose merge bot handles
// merge-ready hides that row with NEEDS_YOU_EXCLUDE_LABELS=merge-ready.
export type NeedsYouKind =
  | "release"
  | "ci"
  | "blocked"
  | "merge"
  | "paused"
  | "failing";

export const KIND_VIEW: Record<NeedsYouKind, View> = {
  release: "releases",
  ci: "releases",
  blocked: "pipeline",
  merge: "pipeline",
  // Usage has no tab of its own.
  paused: "agents",
  failing: "health",
};

/**
 * One underlying item of a row: what a project filter (#167) matches on. A
 * row is a group ("2 PRs ready to merge"); its items say which repo or agent
 * each member belongs to, so a scoped row can be rebuilt from a subset.
 */
export type RowItem = {
  /** "owner/name" as the source returns it; null for an agent's own row. */
  repo: string | null;
  /** The agent a "failing" item is about. */
  agent?: string;
  /** What the row's detail line lists, e.g. "js-common#2". */
  label: string;
  /** ISO time the item started waiting. */
  at: string;
  /** The alert key (#45), when a rule reads the item. */
  key?: string;
  /** A blocked item that is a PR, not an issue. */
  pr?: boolean;
};

// One row per item type, e.g. "2 releases waiting for your approval", except
// "failing", which has one row per failing agent.
export type NeedsYouRow = {
  kind: NeedsYouKind;
  title: string;
  detail: string;
  // How many underlying items the row covers; feeds the tab count pill.
  count: number;
  // ISO time of the oldest item in the row.
  since: string;
  // Unix seconds the item clears by itself (a usage pause), shown as a countdown.
  resetsAt?: number | null;
  // The alert items (#45) the row covers, so snooze and ack (#46) can mute
  // them. Absent on rows no alert rule reads.
  keys?: string[];
  // The items behind the row, for the project filter (#167). Absent on a
  // hive-wide row such as a usage pause.
  items?: RowItem[];
};

export function oldestFirst(rows: NeedsYouRow[]): NeedsYouRow[] {
  return rows.toSorted((a, b) => a.since.localeCompare(b.since));
}

export function countsByView(
  rows: NeedsYouRow[],
): Partial<Record<View, number>> {
  const counts: Partial<Record<View, number>> = {};
  for (const row of rows) {
    const view = KIND_VIEW[row.kind];
    counts[view] = (counts[view] ?? 0) + row.count;
  }
  return counts;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "2 PRs ready to merge". */
export const mergeTitle = (n: number) => `${plural(n, "PR")} ready to merge`;

/** "2 issues blocked", or "items" when a PR is among them. */
export const blockedTitle = (n: number, anyPr: boolean) =>
  `${plural(n, anyPr ? "item" : "issue")} blocked`;

/** "1 release waiting for your approval". */
export const releaseTitle = (n: number) =>
  n === 1
    ? "1 release waiting for your approval"
    : `${n} releases waiting for your approval`;

/** "Red CI on main in 2 repos". */
export const ciTitle = (n: number) =>
  n === 1 ? "Red CI on main in 1 repo" : `Red CI on main in ${n} repos`;

/** The detail line for a group: its distinct labels, in order. */
export const detailOf = (items: Pick<RowItem, "label">[]) =>
  [...new Set(items.map((i) => i.label))].join(", ");

/** The oldest of the items' times, ISO. */
export const oldestOf = (items: Pick<RowItem, "at">[]) =>
  items.map((i) => i.at).sort()[0] ?? "";

/**
 * The row for just `items`, a subset of its own. Title, detail, count, time
 * and alert keys follow the subset; a row that keeps every item comes back
 * as it was. The failing and paused rows never split.
 */
export function rowFor(row: NeedsYouRow, items: RowItem[]): NeedsYouRow {
  if (row.items && items.length === row.items.length) return row;
  const keys = items.flatMap((i) => (i.key ? [i.key] : []));
  const base = {
    ...row,
    detail: detailOf(items),
    count: items.length,
    since: oldestOf(items),
    keys: row.keys ? keys : undefined,
    items,
  };
  switch (row.kind) {
    case "merge":
      return { ...base, title: mergeTitle(items.length) };
    case "blocked":
      return {
        ...base,
        title: blockedTitle(
          items.length,
          items.some((i) => i.pr),
        ),
      };
    case "release":
      return { ...base, title: releaseTitle(items.length) };
    case "ci":
      return { ...base, title: ciTitle(items.length) };
    default:
      return row;
  }
}

/**
 * What the Needs you slot shows on a page (#190). Only Overview (`/`) gets
 * Needs you: the one-row banner, or the full card (the "All clear" line) when
 * nothing is waiting. Every other view shows none of it; the sidebar counts
 * and the bell already flag pending items.
 */
export function needsYouSlotMode(
  pathname: string | null,
  items: number,
): "banner" | "card" | "none" {
  if (pathname !== "/") return "none";
  return items > 0 ? "banner" : "card";
}
