import type { HistoryEvent, NewHistoryEvent } from "./history-schema";
import type { FeedItem } from "./hive";

// The Timeline view (#41, DESIGN.md → Timeline): history rows turned into
// feed rows, plus the URL filters. Pure, so the page and the tests share it.

export const TYPES = {
  messages: { label: "Messages", kinds: ["message"] },
  issues: { label: "Issues", kinds: ["claimed"] },
  prs: {
    label: "PRs",
    kinds: ["pr_opened", "pr_reviewed", "pr_merged", "pr_closed"],
  },
  labels: { label: "Labels", kinds: ["labelled"] },
  releases: { label: "Releases", kinds: ["released"] },
} as const;
export type EventType = keyof typeof TYPES;

export const RANGES = {
  "1d": { label: "Today", days: 1 },
  "7d": { label: "Last 7 days", days: 7 },
  "14d": { label: "Last 14 days", days: 14 },
  "30d": { label: "Last 30 days", days: 30 },
  "90d": { label: "Last 90 days", days: 90 },
} as const;
export type Range = keyof typeof RANGES;
export const DEFAULT_RANGE: Range = "14d";

export type Filters = {
  q: string;
  repo: string | null;
  agent: string | null;
  source: "github" | "buzz" | null;
  type: EventType | null;
  range: Range;
};

const pick = <T extends string>(v: unknown, keys: readonly T[]) =>
  typeof v === "string" && (keys as readonly string[]).includes(v)
    ? (v as T)
    : null;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

/** The filters from the page's search params; anything unknown is dropped. */
export function parseFilters(
  p: Record<string, string | string[] | undefined>,
): Filters {
  return {
    q: str(p.q)?.trim() ?? "",
    repo: str(p.repo),
    agent: str(p.agent),
    source: pick(p.source, ["github", "buzz"]),
    type: pick(p.type, Object.keys(TYPES) as EventType[]),
    range: pick(p.range, Object.keys(RANGES) as Range[]) ?? DEFAULT_RANGE,
  };
}

export type RowIcon =
  | "merged"
  | "opened"
  | "closed"
  | "claimed"
  | "message"
  | "other";

export type Row = {
  id: string;
  /** Unix seconds. */
  at: number;
  source: "github" | "buzz";
  icon: RowIcon;
  actor: string;
  verb: string;
  /** "repo#12", shown in mono. */
  target: string | null;
  snippet: string;
  chips: string[];
  url: string | null;
};

/** Names for raw actors: hex pubkeys to agent names, channel ids to names. */
export type Names = {
  actor: (raw: string) => string;
  channel: (id: string) => string | null;
};

const SNIPPET = 160;

/**
 * One line of `text` for the feed: the start, or with a search the part around
 * the first match, so the highlight is always in view.
 */
export function snippet(text: string, q = ""): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= SNIPPET) return flat;
  const hit = q ? flat.toLowerCase().indexOf(q.toLowerCase()) : -1;
  const start = hit < 0 ? 0 : Math.max(0, hit - 50);
  const end = start + SNIPPET;
  return `${start > 0 ? "…" : ""}${flat.slice(start, end).trim()}${end < flat.length ? "…" : ""}`;
}

/** `text` split so every odd entry is a case-insensitive match of `q`. */
export function splitMatches(text: string, q: string): string[] {
  if (!q) return [text];
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.split(new RegExp(`(${escaped})`, "i"));
}

const GITHUB: Record<string, [RowIcon, string]> = {
  pr_opened: ["opened", "opened"],
  pr_reviewed: ["opened", "reviewed"],
  pr_merged: ["merged", "merged"],
  pr_closed: ["closed", "closed"],
  claimed: ["claimed", "claimed"],
};

// "added ai-ready to" / "removed ai-wip from" for a label row (#54).
function githubVerb(e: HistoryEvent): string {
  const label = e.data?.label;
  if (e.kind === "labelled" && typeof label === "string") {
    return e.data?.action === "removed"
      ? `removed ${label} from`
      : `added ${label} to`;
  }
  return e.kind.replace(/_/g, " ");
}

export function toRow(e: HistoryEvent, names: Names, q = ""): Row {
  const at = Math.floor(e.at.getTime() / 1000);
  const id = `${e.source}:${e.sourceId}`;
  if (e.source === "buzz") {
    const channel = e.channel ? names.channel(e.channel) : null;
    return {
      id,
      at,
      source: "buzz",
      icon: e.kind === "message" ? "message" : "other",
      actor: e.actor ? names.actor(e.actor) : "Someone",
      verb: channel ? `posted in #${channel}` : "posted",
      target: null,
      snippet: snippet(e.body ?? e.title ?? "", q),
      chips: channel ? [`#${channel}`] : [],
      url: e.url,
    };
  }
  const [icon, verb] = GITHUB[e.kind] ?? ["other", githubVerb(e)];
  const number = e.data?.number;
  // The mockups name a repo without its owner: "example-app#42".
  const name = e.repo?.split("/").pop();
  if (e.kind === "released") {
    const tag = typeof e.data?.tag === "string" ? e.data.tag : null;
    return {
      id,
      at,
      source: "github",
      icon,
      actor: e.actor ? names.actor(e.actor) : "Someone",
      verb,
      target: name && tag ? `${name} ${tag}` : (name ?? null),
      snippet: snippet(e.title ?? "", q),
      chips: name ? [name] : [],
      url: e.url,
    };
  }
  return {
    id,
    at,
    source: "github",
    icon,
    actor: e.actor ? names.actor(e.actor) : "Someone",
    verb,
    target: name && typeof number === "number" ? `${name}#${number}` : null,
    snippet: snippet(e.title ?? e.body ?? "", q),
    chips: name ? [name] : [],
    url: e.url,
  };
}

export type DayGroup = { start: number; rows: Row[] };

/** Rows (newest first) under the day `dayStart` puts them in. */
export function groupByDay(rows: Row[], dayStart: (at: number) => number) {
  const groups: DayGroup[] = [];
  for (const row of rows) {
    const start = dayStart(row.at);
    const last = groups.at(-1);
    if (last?.start === start) last.rows.push(row);
    else groups.push({ start, rows: [row] });
  }
  return groups;
}

/**
 * The live feed without a database (#53): the ingester's GitHub rows and the
 * relay's feed, as events for toRow. Only those at or after `since` (unix
 * seconds), newest first. A Buzz event's channel is the name, not the id.
 */
export function liveEvents(
  github: NewHistoryEvent[],
  feed: FeedItem[],
  since: number,
): HistoryEvent[] {
  const blank = {
    actor: null,
    repo: null,
    channel: null,
    title: null,
    url: null,
    body: null,
    data: null,
    ingestedAt: new Date(0),
    hive: null,
  };
  return [
    ...github.map((e) => ({ ...blank, ...e })),
    ...feed.map((m) => ({
      ...blank,
      source: "buzz",
      sourceId: m.id,
      kind: "message",
      at: new Date(m.at * 1000),
      actor: m.author,
      channel: m.channel,
      body: m.text,
    })),
  ]
    .filter((e) => e.at.getTime() / 1000 >= since)
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** The live feed's two filters, type and agent (`actors`: its names and keys). */
export function liveMatches(
  e: HistoryEvent,
  type: EventType | null,
  actors: string[] | null,
): boolean {
  if (type && !(TYPES[type].kinds as readonly string[]).includes(e.kind))
    return false;
  return !actors || (e.actor !== null && actors.includes(e.actor));
}
