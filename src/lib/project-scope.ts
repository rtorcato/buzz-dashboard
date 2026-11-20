import { type NeedsYouRow, rowFor } from "./needs-you-rows";

// The project filter (#167), the pure parts: which repos, channels and agents
// belong to a project, and what a view keeps when one is picked. Pure, so it
// tests without a database and runs in the browser too. The registry reads
// that feed it are in project-store.ts and project-data.ts.

/** The model a project releases by, as the registry stores it. */
export type ReleaseModelName =
  | "changesets"
  | "milestone"
  | "app_dev"
  | "none"
  | "unknown";

/** One project, flattened for filters and the switcher. Serializable. */
export type ScopeProject = {
  slug: string;
  name: string;
  /** Up to 3 capitals, e.g. "DB"; null when the owner set none. */
  shortLabel: string | null;
  releaseModel: ReleaseModelName;
  defaultBranch: string;
  devBranch: string | null;
  /** "owner/name", lowercase, the primary one first. */
  repos: string[];
  /** Relay channel ids, the home channel first. */
  channels: string[];
  /** The channels' names where the relay names them, same order; "" if not. */
  channelNames: string[];
  /** Names of the project's agents, as the Agents view lists them. */
  agents: string[];
};

/** What a view filters by: one project, or several unioned. */
export type Scope = {
  slugs: string[];
  /** The projects' names, in slug order. */
  names: string[];
  repos: string[];
  channels: string[];
  agents: string[];
};

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_SLUGS = 8;

/** The `project` query param's slugs: comma separated, valid, no repeats. */
export function parseProjectParam(
  raw: string | string[] | null | undefined,
): string[] {
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (!text) return [];
  const slugs = text
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => SLUG.test(s));
  return [...new Set(slugs)].slice(0, MAX_SLUGS);
}

/** The slug in a "/projects/<slug>" path, or null on any other path. */
export function slugOfPath(pathname: string): string | null {
  const m = /^\/projects\/([^/]+)\/?$/.exec(pathname);
  return m && SLUG.test(m[1]) ? m[1] : null;
}

/**
 * The scope for `slugs`: those that name a project are unioned; the rest come
 * back as `unknown`. Null scope when none matches, so a view shows everything.
 */
export function resolveScope(
  projects: ScopeProject[],
  slugs: string[],
): { scope: Scope | null; unknown: string[] } {
  const found = slugs.flatMap((s) => {
    const p = projects.find((x) => x.slug === s);
    return p ? [p] : [];
  });
  const unknown = slugs.filter((s) => !projects.some((p) => p.slug === s));
  if (found.length === 0) return { scope: null, unknown };
  const uniq = (list: string[]) => [...new Set(list)];
  return {
    unknown,
    scope: {
      slugs: found.map((p) => p.slug),
      names: found.map((p) => p.name),
      repos: uniq(found.flatMap((p) => p.repos)),
      channels: uniq(found.flatMap((p) => p.channels)),
      agents: uniq(found.flatMap((p) => p.agents)),
    },
  };
}

/** The scope of one project. */
export const scopeOfProject = (p: ScopeProject): Scope =>
  resolveScope([p], [p.slug]).scope as Scope;

/** The chip's text: "db-common", or "db-common + 1". */
export const chipLabel = (scope: Pick<Scope, "names">): string =>
  scope.names.length > 1
    ? `${scope.names[0]} + ${scope.names.length - 1}`
    : (scope.names[0] ?? "");

const lower = (s: string | null | undefined) => s?.toLowerCase() ?? null;

/** Whether a repo ("owner/name", any case) is in the scope. */
export const repoInScope = (
  scope: Pick<Scope, "repos">,
  repo: string | null | undefined,
): boolean => {
  const r = lower(repo);
  return r !== null && scope.repos.includes(r);
};

/** Whether a Buzz channel id is in the scope. */
export const channelInScope = (
  scope: Pick<Scope, "channels">,
  channel: string | null | undefined,
): boolean => Boolean(channel) && scope.channels.includes(channel as string);

/** Whether an agent, by name, is in the scope. */
export const agentInScope = (
  scope: Pick<Scope, "agents">,
  name: string | null | undefined,
): boolean => Boolean(name) && scope.agents.includes(name as string);

/**
 * The filters a stored-event query takes for a scope: `lower(repo) = ANY` and
 * `channel = ANY`, the two the events table is indexed on (#166). Repos are
 * lowercase already, as the registry stores them.
 */
export const eventScope = (scope: Pick<Scope, "repos" | "channels">) => ({
  repos: scope.repos.map((r) => r.toLowerCase()),
  channels: [...scope.channels],
});

/**
 * The rows that belong to the scope, rebuilt to just the scope's items: "2 PRs
 * ready to merge" in two projects is "1 PR ready to merge" in one. A row with
 * no items (a usage pause) is hive-wide and drops out of a scoped view.
 */
export function scopeNeedsYou(
  rows: NeedsYouRow[],
  scope: Scope | null,
): NeedsYouRow[] {
  if (!scope) return rows;
  return rows.flatMap((row) => {
    if (!row.items) return [];
    const mine = row.items.filter((i) =>
      i.repo !== null
        ? repoInScope(scope, i.repo)
        : agentInScope(scope, i.agent),
    );
    return mine.length ? [rowFor(row, mine)] : [];
  });
}

/** How many things need the owner in one project. */
export const needsYouCount = (
  rows: NeedsYouRow[],
  project: ScopeProject,
): number =>
  scopeNeedsYou(rows, scopeOfProject(project)).reduce((n, r) => n + r.count, 0);

/** How many rows' items fall outside the scope: "2 more in other projects". */
export function elsewhereCount(
  rows: NeedsYouRow[],
  scope: Scope | null,
): number {
  if (!scope) return 0;
  const all = rows.reduce((n, r) => n + r.count, 0);
  const mine = scopeNeedsYou(rows, scope).reduce((n, r) => n + r.count, 0);
  return all - mine;
}

/** "Changesets", "Milestone batch", "App · dev → main". */
export function releaseModelLabel(
  p: Pick<ScopeProject, "releaseModel" | "defaultBranch" | "devBranch">,
): string {
  switch (p.releaseModel) {
    case "changesets":
      return "Changesets";
    case "milestone":
      return "Milestone batch";
    case "app_dev":
      return `App · ${p.devBranch ?? "dev"} → ${p.defaultBranch}`;
    case "none":
      return "No releases";
    default:
      return "Release model not set";
  }
}

/** An app ships from a dev branch; everything else is a library. */
export const isApp = (p: Pick<ScopeProject, "releaseModel">): boolean =>
  p.releaseModel === "app_dev";

/** Up to two letters for a project's tile: its label, else its name's start. */
export function projectInitials(
  p: Pick<ScopeProject, "name" | "shortLabel">,
): string {
  if (p.shortLabel) return p.shortLabel;
  const words = p.name.split(/[\s_-]+/).filter(Boolean);
  const letters =
    words.length > 1
      ? words
          .slice(0, 2)
          .map((w) => w[0])
          .join("")
      : p.name.slice(0, 2);
  return letters.toUpperCase();
}

/**
 * `href` with its project filter set to `slugs`, or removed with none. Any
 * other query and the hash stay as they are.
 */
export function withProject(href: string, slugs: string[]): string {
  const hashAt = href.indexOf("#");
  const hash = hashAt === -1 ? "" : href.slice(hashAt);
  const rest = hashAt === -1 ? href : href.slice(0, hashAt);
  const qAt = rest.indexOf("?");
  const path = qAt === -1 ? rest : rest.slice(0, qAt);
  const params = new URLSearchParams(qAt === -1 ? "" : rest.slice(qAt + 1));
  if (slugs.length) params.set("project", slugs.join(","));
  else params.delete("project");
  const query = params.toString().replace(/%2C/g, ",");
  return `${path}${query ? `?${query}` : ""}${hash}`;
}

/**
 * Which project a channel is in, as the Cost table's Project column says it:
 * the project's name, "Hive-wide", or "Unassigned" when the registry hasn't
 * placed it.
 */
export function channelProjectLabel(
  channelId: string,
  projects: Pick<ScopeProject, "name" | "channels">[],
  hiveWide: string[],
): string {
  const p = projects.find((x) => x.channels.includes(channelId));
  if (p) return p.name;
  return hiveWide.includes(channelId) ? HIVE_WIDE : UNASSIGNED;
}

/** A hive-wide channel's label in place of a project. */
export const HIVE_WIDE = "Hive-wide";
/** Spend that carries no channel tag, so it belongs to no project (#167). */
export const NOT_ATTRIBUTED = "Not attributed to a project";
/** A channel the registry hasn't placed. */
export const UNASSIGNED = "Unassigned";
