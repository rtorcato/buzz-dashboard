import type { NostrEvent } from "./relay";

// The read-only channel map (#168): every channel the relay lists, the project
// it maps to (#166), its members and whether the dashboard's own identity can
// read it. Pure, so the page only has to feed it what it already reads.

export type ChannelScope = "project" | "hive_wide" | "unassigned";

export type ChannelProject = {
  slug: string;
  name: string;
  shortLabel: string | null;
};

export type ChannelMember = {
  pubkey: string;
  /** The agent's name, or null for a person (the owner). */
  name: string | null;
  picture: string | null;
};

export type ChannelRow = {
  id: string;
  name: string;
  /** Private channels show a lock; open ones a #. */
  isPrivate: boolean;
  archived: boolean;
  /** A private channel is readable only if the dashboard is a member. */
  readable: boolean;
  scope: ChannelScope;
  project: ChannelProject | null;
  /** The project's home channel. */
  home: boolean;
  members: ChannelMember[];
  /** Unix seconds of the newest message the relay returned, or null. */
  lastMessageAt: number | null;
};

export type ChannelMap = {
  rows: ChannelRow[];
  /** False when the registry isn't available: no project column then. */
  registry: boolean;
  /** Projects that have a channel, for the filter. */
  projects: ChannelProject[];
};

export type ChannelAssignmentInput = {
  channelId: string;
  scope: "project" | "hive_wide";
  /** The project's slug for a project channel. */
  project: string | null;
  home: boolean;
};

const tag = (event: NostrEvent, name: string) =>
  event.tags.find((t) => t[0] === name)?.[1];

const hasTag = (event: NostrEvent, name: string) =>
  event.tags.some((t) => t[0] === name);

/** Newest event per channel id (the `d` tag) of one kind. */
function newestByChannel(events: NostrEvent[], kind: number) {
  const out = new Map<string, NostrEvent>();
  for (const e of events) {
    if (e.kind !== kind) continue;
    const id = tag(e, "d");
    if (!id) continue;
    const old = out.get(id);
    if (!old || old.created_at < e.created_at) out.set(id, e);
  }
  return out;
}

/**
 * Builds the map from relay metadata (kind 39000), member lists (kind 39002)
 * and the registry. A channel is archived when its metadata carries an
 * `archived` tag.
 */
export function buildChannelMap({
  events,
  dashboard,
  assignments,
  projects,
  agents,
  lastMessageByName,
}: {
  events: NostrEvent[];
  /** The dashboard identity's hex pubkey. */
  dashboard: string;
  /** Null when the registry isn't available. */
  assignments: ChannelAssignmentInput[] | null;
  projects: ChannelProject[];
  /** The hive's agents, to name members. */
  agents: { name: string; picture: string | null; pubkeys: string[] }[];
  /** Newest message time by channel name, from the hive read. */
  lastMessageByName: Record<string, number>;
}): ChannelMap {
  const meta = newestByChannel(events, 39000);
  const lists = newestByChannel(events, 39002);
  const byPubkey = new Map<string, { name: string; picture: string | null }>();
  for (const a of agents) {
    for (const k of a.pubkeys) byPubkey.set(k, a);
  }
  const bySlug = new Map(projects.map((p) => [p.slug, p]));
  const assigned = new Map((assignments ?? []).map((a) => [a.channelId, a]));

  const rows = [...meta]
    .map(([id, m]): ChannelRow | null => {
      const name = tag(m, "name");
      if (!name) return null;
      const pubkeys = [
        ...new Set(
          (lists.get(id)?.tags ?? [])
            .filter((t) => t[0] === "p" && /^[0-9a-f]{64}$/.test(t[1] ?? ""))
            .map((t) => t[1]),
        ),
      ];
      const isPrivate = hasTag(m, "private");
      const a = assigned.get(id);
      const project = a?.project ? (bySlug.get(a.project) ?? null) : null;
      const scope: ChannelScope =
        a?.scope === "hive_wide"
          ? "hive_wide"
          : a?.scope === "project" && project
            ? "project"
            : "unassigned";
      return {
        id,
        name,
        isPrivate,
        archived: hasTag(m, "archived"),
        readable: !isPrivate || pubkeys.includes(dashboard),
        scope,
        project: scope === "project" ? project : null,
        home: scope === "project" && a?.home === true,
        members: pubkeys
          // Agents first, then people, each by name so the order is stable.
          .map((pubkey): ChannelMember => {
            const agent = byPubkey.get(pubkey);
            return {
              pubkey,
              name: agent?.name ?? null,
              picture: agent?.picture ?? null,
            };
          })
          .sort(
            (x, y) =>
              Number(y.name !== null) - Number(x.name !== null) ||
              (x.name ?? x.pubkey).localeCompare(y.name ?? y.pubkey),
          ),
        lastMessageAt: lastMessageByName[name] ?? null,
      };
    })
    .filter((r): r is ChannelRow => r !== null)
    // Live channels first, then the newest message, then by name.
    .sort(
      (a, b) =>
        Number(a.archived) - Number(b.archived) ||
        (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0) ||
        a.name.localeCompare(b.name),
    );

  const used = new Set(
    rows.flatMap((r) => (r.project ? [r.project.slug] : [])),
  );
  return {
    rows,
    registry: assignments !== null,
    projects: projects.filter((p) => used.has(p.slug)),
  };
}

export const CHANNEL_TABS = [
  "all",
  "unreadable",
  "unassigned",
  "archived",
] as const;
export type ChannelTab = (typeof CHANNEL_TABS)[number];

/** Live channels the dashboard can't read: the gap the banner reports.
 * Archived ones leave every tab but their own and All. */
export const isUnreadable = (r: ChannelRow) => !r.archived && !r.readable;

const IN_TAB: Record<ChannelTab, (r: ChannelRow) => boolean> = {
  all: () => true,
  unreadable: isUnreadable,
  unassigned: (r) => !r.archived && r.scope === "unassigned",
  archived: (r) => r.archived,
};

export const inTab = (rows: ChannelRow[], tab: ChannelTab) =>
  rows.filter(IN_TAB[tab]);

/**
 * Names of the unreadable channels each agent belongs to, keyed by agent name.
 * Feeds "Active elsewhere" on the Agents view.
 */
export function unreadableByAgent(
  rows: ChannelRow[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    if (!isUnreadable(r)) continue;
    for (const m of r.members) {
      if (m.name) out[m.name] = [...(out[m.name] ?? []), r.name];
    }
  }
  return out;
}
