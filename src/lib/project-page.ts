import type { GitHub, GitHubItem } from "./github";
import { repoInScope, type Scope } from "./project-scope";

// What a project's page (#167) works out from the GitHub read: its PRs, their
// stage, its KPIs and the asks waiting on the owner. Pure, so the page and
// the tests share it.

const DAY_S = 86_400;

export type StageTone =
  | "merge"
  | "release"
  | "database"
  | "blocked"
  | "review"
  | "muted";

export type PrStage = { label: string; tone: StageTone };

/** Where a PR stands, from its labels and title. */
export function prStage(pr: GitHubItem): PrStage {
  if (pr.mergedAt !== null) return { label: "merged", tone: "muted" };
  if (pr.closedAt !== null) return { label: "closed", tone: "muted" };
  const has = (l: string) => pr.labels.includes(l);
  if (has("ai-blocked")) return { label: "ai-blocked", tone: "blocked" };
  if (has("ai-changes")) return { label: "ai-changes", tone: "blocked" };
  if (has("merge-ready")) return { label: "merge-ready", tone: "merge" };
  if (/^chore(\([^)]*\))?:\s*version packages/i.test(pr.title)) {
    return { label: "release", tone: "release" };
  }
  if (has("ai-needs-db")) return { label: "ai-needs-db", tone: "database" };
  if (has("ai-review")) return { label: "ai-review", tone: "review" };
  return { label: "open", tone: "muted" };
}

/** The project's PRs from the 30 day read, newest first. */
export const projectPrs = (github: GitHub, scope: Scope): GitHubItem[] =>
  github.prs.filter((p) => repoInScope(scope, p.repo));

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = xs.toSorted((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export type ProjectKpis = {
  openPrs: number;
  mergeReady: number;
  merged7d: number;
  /** Seconds from opened to merged, the median over the last 7 days. */
  medianOpenToMerged: number | null;
  /** Open issues and PRs an agent holds (a claim label). */
  claimed: number;
  blocked: number;
};

/** The page's four tiles, from this project's PRs and claims. */
export function projectKpis(
  github: GitHub,
  scope: Scope,
  now: number,
): ProjectKpis {
  const prs = projectPrs(github, scope);
  const open = prs.filter((p) => p.closedAt === null);
  const merged = prs.filter(
    (p) => p.mergedAt !== null && p.mergedAt >= now - 7 * DAY_S,
  );
  const claims = github.claims.filter(
    (c) => c.closedAt === null && repoInScope(scope, c.repo),
  );
  return {
    openPrs: open.length,
    mergeReady: open.filter((p) => p.labels.includes("merge-ready")).length,
    merged7d: merged.length,
    medianOpenToMerged: median(
      merged.flatMap((p) => (p.mergedAt ? [p.mergedAt - p.createdAt] : [])),
    ),
    claimed: claims.length,
    blocked: claims.filter((c) => c.labels.includes("ai-blocked")).length,
  };
}

export type Ask = {
  kind: "blocked" | "merge" | "needs";
  title: string;
  /** "db-common#212". */
  ref: string;
  url: string;
  /** What it is waiting on, e.g. "ai-needs-db". */
  detail: string;
  /** Unix seconds it started waiting. */
  since: number;
  agent: string | null;
};

const refOf = (i: GitHubItem) => `${i.repo.split("/").pop()}#${i.number}`;

/**
 * What waits on a human in this project, oldest first: blocked items, PRs
 * ready to merge, and PRs carrying an `ai-needs-*` label for a specialist.
 */
export function openAsks(github: GitHub, scope: Scope): Ask[] {
  const asks: Ask[] = [];
  const seen = new Set<string>();
  const add = (
    i: GitHubItem,
    ask: Omit<Ask, "title" | "ref" | "url" | "agent">,
  ) => {
    const key = `${i.repo}#${i.number}`;
    if (seen.has(key)) return;
    seen.add(key);
    asks.push({
      ...ask,
      title: i.title,
      ref: refOf(i),
      url: i.url,
      agent: i.agent,
    });
  };
  for (const c of github.claims) {
    if (
      c.closedAt === null &&
      repoInScope(scope, c.repo) &&
      c.labels.includes("ai-blocked")
    ) {
      add(c, { kind: "blocked", detail: "ai-blocked", since: c.claimedAt });
    }
  }
  for (const p of projectPrs(github, scope)) {
    if (p.closedAt !== null) continue;
    if (p.labels.includes("merge-ready")) {
      add(p, { kind: "merge", detail: "merge-ready", since: p.createdAt });
      continue;
    }
    const needs = p.labels.find((l) => l.startsWith("ai-needs-"));
    if (needs) add(p, { kind: "needs", detail: needs, since: p.createdAt });
  }
  return asks.toSorted((a, b) => a.since - b.since);
}

export type PrTab = "open" | "merged";

/** The page's PR table: open PRs, or the ones merged in the last 30 days. */
export function prsFor(prs: GitHubItem[], tab: PrTab): GitHubItem[] {
  return tab === "merged"
    ? prs.filter((p) => p.mergedAt !== null)
    : prs.filter((p) => p.closedAt === null);
}

/** "Open", "Merged" from the `prs` query param. */
export const parsePrTab = (raw: string | null): PrTab =>
  raw === "merged" ? "merged" : "open";
