import { connection } from "next/server";
import { cache } from "react";
import { formatAge } from "./age";
import { runtimeFor } from "./agents";
import { type GitHub, loadGitHub } from "./github";
import {
  type FailingAgent,
  type HealthBucket,
  type HealthSource,
  type QuietClaim,
  quietClaims,
} from "./health";
import { loadFailing, recentBuckets } from "./health-data";
import { type Hive, loadHive } from "./hive";
import {
  blockedTitle,
  ciTitle,
  detailOf,
  mergeTitle,
  type NeedsYouRow,
  oldestOf,
  type RowItem,
  releaseTitle,
} from "./needs-you-rows";
import { loadReleases, type Releases } from "./releases";
import { sampleMergeRow, sampleMode } from "./sample-data";
import { loadStatusFeed, type StatusFeed } from "./status-feed";
import { trippedDetail, usageState } from "./usage";

export {
  countsByView,
  KIND_VIEW,
  type NeedsYouKind,
  type NeedsYouRow,
  oldestFirst,
  type RowItem,
  VIEWS,
  type View,
} from "./needs-you-rows";

// Alert item keys, shared by the rows and the alerts pass.
export const failingKey = (agent: string) => `failing:${agent}`;
export const mergeKey = (pr: { repo: string; number: number }) =>
  `merge:${pr.repo}#${pr.number}`;
export const blockedKey = (item: { repo: string; number: number }) =>
  `blocked:${item.repo}#${item.number}`;
export const silentKey = (agent: string) => `silent:${agent}`;
export const budgetKey = (agent: string) => `budget:${agent}`;
export const releaseKey = (repo: string, runId: number) =>
  `release:${repo}#run-${runId}`;

// A source the dashboard can't read, shown as a destructive Alert.
export type SourceFailure = { source: string; detail: string };

export type NeedsYou = {
  // False until a real source feeds the card. "All clear" needs every source
  // to have answered, so a disconnected card never shows it.
  connected: boolean;
  rows: NeedsYouRow[];
  // Not counted, e.g. "Honey has been quiet for 3h while holding a claim."
  headsUp: string[];
  failures: SourceFailure[];
  // ISO time of the oldest successful source fetch, or null if none succeeded.
  updatedAt: string | null;
};

const RELAY = "the Buzz relay";

// Config problems we can see without a fetch. getNeedsYou adds fetch failures.
export function configFailures(
  env: Record<string, string | undefined>,
): SourceFailure[] {
  const failures: SourceFailure[] = [];
  const missing = ["BUZZ_RELAY_URL", "BUZZ_PRIVATE_KEY"].filter((n) => !env[n]);
  if (missing.length > 0) {
    failures.push({
      source: RELAY,
      detail: `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set, so Agents and Timeline can't load.`,
    });
  } else if (!/^[0-9a-f]{64}$/i.test(env.BUZZ_PRIVATE_KEY ?? "")) {
    failures.push({
      source: RELAY,
      detail:
        "BUZZ_PRIVATE_KEY must be a 64-character hex key, so Agents and Timeline can't load.",
    });
  }
  if (!env.GITHUB_TOKEN) {
    failures.push({
      source: "GitHub",
      detail:
        "GITHUB_TOKEN is not set, so Pipeline, Releases and this card can't load.",
    });
  }
  return failures;
}

/** The "Paused for usage" row, or null when not paused or the reset has passed. */
export function pausedRow(feed: StatusFeed | null, now: number) {
  if (!feed?.usage) return null;
  const { tripped, resumesAt } = usageState(feed.usage, now);
  if (!tripped || (resumesAt !== null && resumesAt <= now)) return null;
  return {
    kind: "paused",
    title: "Paused for usage",
    detail: trippedDetail(feed.usage, tripped),
    count: 1,
    since: new Date(feed.publishedAt * 1000).toISOString(),
    resetsAt: resumesAt,
  } satisfies NeedsYouRow;
}

const short = (repo: string) => repo.split("/").pop() ?? repo;
const iso = (s: number) => new Date(s * 1000).toISOString();

export const MERGE_READY = "merge-ready";
export const AI_BLOCKED = "ai-blocked";

/** NEEDS_YOU_EXCLUDE_LABELS, a comma list of labels to leave off the card. */
export const excludedLabels = (raw: string | undefined) =>
  new Set(
    (raw ?? "")
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean),
  );

/** The "Ready to merge" row for open merge-ready PRs, or null when none. */
export function mergeRow(github: GitHub) {
  // ponytail: reads the PR window (30 days), so an older merge-ready PR is
  // missed. Search the label directly if that ever matters.
  const prs = github.prs.filter(
    (p) => p.closedAt === null && p.labels.includes(MERGE_READY),
  );
  if (prs.length === 0) return null;
  const items: RowItem[] = prs.map((p) => ({
    repo: p.repo,
    label: `${short(p.repo)}#${p.number}`,
    at: iso(p.createdAt),
    key: mergeKey(p),
  }));
  return {
    kind: "merge",
    title: mergeTitle(prs.length),
    detail: detailOf(items),
    count: prs.length,
    since: oldestOf(items),
    keys: items.map((i) => i.key ?? ""),
    items,
  } satisfies NeedsYouRow;
}

/** Open issues and PRs an agent gave up on, labelled ai-blocked. */
export const blockedItems = (github: GitHub) =>
  github.claims.filter(
    (c) => c.closedAt === null && c.labels.includes(AI_BLOCKED),
  );

/** The "Issue blocked" row for open ai-blocked items, or null when none. */
export function blockedRow(github: GitHub) {
  const items = blockedItems(github);
  if (items.length === 0) return null;
  const rowItems: RowItem[] = items.map((i) => ({
    repo: i.repo,
    label: `${short(i.repo)}#${i.number}`,
    at: iso(i.claimedAt),
    key: blockedKey(i),
    pr: i.isPr,
  }));
  return {
    kind: "blocked",
    title: blockedTitle(
      items.length,
      items.some((i) => i.isPr),
    ),
    detail: detailOf(rowItems),
    count: items.length,
    since: oldestOf(rowItems),
    keys: rowItems.map((i) => i.key ?? ""),
    items: rowItems,
  } satisfies NeedsYouRow;
}

/**
 * Who holds a claim and since when they went quiet, from the sources Health
 * reads: relay presence, the status feed's turns, stored health events and the
 * GitHub claims with a known agent.
 */
export function quietAgents(
  hive: Hive,
  feed: StatusFeed | null,
  github: GitHub,
  buckets: HealthBucket[],
): QuietClaim[] {
  return quietClaims({
    agents: hive.agents.map((a) => ({
      name: a.name,
      lastSeenAt: a.lastSeenAt,
      runtime: feed ? runtimeFor(a, feed.runtime) : undefined,
    })),
    claims: github.claims.flatMap((c) =>
      c.agent
        ? [
            {
              agent: c.agent,
              key: `${c.repo.split("/")[1]}#${c.number}`,
              claimedAt: c.claimedAt,
            },
          ]
        : [],
    ),
    buckets,
  });
}

/** Heads-up: quiet this long while holding a claim (DESIGN.md → Shell). */
export const HEADS_UP_QUIET_S = 2 * 3600;

/** "Honey has been quiet for 3h while holding js-common#124 and 1 more." */
export const quietLine = (q: QuietClaim, now: number) =>
  `${q.agent} has been quiet for ${formatAge((now - q.since) * 1000)} while holding ${q.key}${q.more ? ` and ${q.more} more` : ""}.`;

/** The "Release waiting for approval" row, or null when none wait. */
export function releaseRow(releases: Releases) {
  const runs = releases.repos.flatMap((r) =>
    r.waiting.map((w) => ({ repo: r.repo, ...w })),
  );
  if (runs.length === 0) return null;
  const items: RowItem[] = runs.map((r) => ({
    repo: r.repo,
    label: short(r.repo),
    at: iso(r.createdAt),
    key: releaseKey(r.repo, r.id),
  }));
  return {
    kind: "release",
    title: releaseTitle(runs.length),
    detail: detailOf(items),
    count: runs.length,
    since: oldestOf(items),
    keys: items.map((i) => i.key ?? ""),
    items,
  } satisfies NeedsYouRow;
}

/** The "Red CI on main" row, or null when every default branch is green. */
export function ciRow(releases: Releases) {
  const red = releases.repos.filter((r) => r.redCi);
  if (red.length === 0) return null;
  const items: RowItem[] = red.map((r) => ({
    repo: r.repo,
    label: short(r.repo),
    at: iso(r.redCi?.since || Date.now() / 1000),
  }));
  return {
    kind: "ci",
    title: ciTitle(red.length),
    detail: detailOf(items),
    count: red.length,
    since: oldestOf(items),
    items,
  } satisfies NeedsYouRow;
}

/** The "Agent failing turns" row for one agent (DESIGN.md → Shell). */
export function failingRow(f: FailingAgent, source: HealthSource) {
  const { attempts, errors } = f.hour;
  return {
    kind: "failing",
    // With OTel the rate is per API request, never per turn.
    title:
      source === "signer"
        ? `${f.agent} is failing turns`
        : `${f.agent} is failing API requests`,
    detail:
      source === "signer"
        ? `${errors} of ${attempts} turns ended in error in the last hour`
        : `${errors} of ${attempts} API requests failed in the last hour`,
    count: 1,
    since: new Date(f.since * 1000).toISOString(),
    keys: [failingKey(f.agent)],
    items: [
      {
        repo: null,
        agent: f.agent,
        label: f.agent,
        at: new Date(f.since * 1000).toISOString(),
        key: failingKey(f.agent),
      },
    ],
  } satisfies NeedsYouRow;
}

// The Needs you items read from GitHub, by the label that marks them.
const GITHUB_READS = {
  merge: "merge-ready PRs",
  blocked: "blocked issues",
} as const;
const GITHUB_LABELS = { merge: MERGE_READY, blocked: AI_BLOCKED } as const;

/** The GitHub items Needs you reads, less those NEEDS_YOU_EXCLUDE_LABELS hides. */
export const githubReads = (excluded: Set<string>) =>
  (["merge", "blocked"] as const).filter(
    (r) => !excluded.has(GITHUB_LABELS[r]),
  );

// A cold GitHub read takes about 20s. The card doesn't hold every page for it;
// the read carries on and the next request shows the row.
export const GITHUB_WAIT_MS = 2_000;
// Once a read misses that wait, later requests give it only this long until
// it answers, so a read that stays cold doesn't cost every page 2s (#162). A
// warm read comes from memory, well inside it.
export const MISSED_WAIT_MS = 100;
const MISSED_FOR_MS = 60_000;
const missedAt = new Map<string, number>();

async function briefly<T>(source: string, p: Promise<T>): Promise<T | null> {
  const missed = Date.now() - (missedAt.get(source) ?? -Infinity);
  const wait = missed < MISSED_FOR_MS ? MISSED_WAIT_MS : GITHUB_WAIT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    p,
    new Promise<null>((r) => {
      timer = setTimeout(r, wait, null);
    }),
  ]);
  clearTimeout(timer);
  if (result === null) missedAt.set(source, Date.now());
  else missedAt.delete(source);
  return result;
}

/** The "owner/repo#N" refs of GitHub items that need the owner, for row tints. */
export const needsYouRefs = (data: NeedsYou) =>
  new Set(
    data.rows.flatMap((r) =>
      (r.keys ?? []).flatMap(
        (k) => k.match(/^(?:merge|blocked):(.+#\d+)$/)?.[1] ?? [],
      ),
    ),
  );

// cache: the layout and the Timeline both read it in one request.
export const getNeedsYou = cache(async (): Promise<NeedsYou> => {
  // Render per request so the data is never baked in at build time.
  await connection();
  if (sampleMode()) {
    const { feed } = await loadStatusFeed();
    const paused = pausedRow(feed, Date.now() / 1000);
    return {
      connected: false,
      rows: [...(paused ? [paused] : []), sampleMergeRow()],
      headsUp: [],
      failures: [],
      updatedAt: new Date().toISOString(),
    };
  }
  const failures = configFailures(process.env);
  // Freshness counts only successful fetches.
  let updatedAt: string | null = null;
  let hive: Hive | null = null;
  if (!failures.some((f) => f.source === RELAY)) {
    const result = await loadHive();
    if (result.hive) {
      updatedAt = result.fetchedAt;
      hive = result.hive;
    } else {
      failures.push({
        source: RELAY,
        detail: `${result.error}, so Agents and Timeline can't load.`,
      });
    }
  }
  const rows: NeedsYouRow[] = [];
  const headsUp: string[] = [];
  const { feed } = await loadStatusFeed();
  const paused = pausedRow(feed, Date.now() / 1000);
  if (paused) rows.push(paused);
  const excluded = excludedLabels(process.env.NEEDS_YOU_EXCLUDE_LABELS);
  const reads = githubReads(excluded);
  const token = Boolean(process.env.GITHUB_TOKEN);
  // Both reads share one wait, so a cold start holds the page 2s, not 4s.
  // Silence needs the claims too, so GitHub is read whenever the relay is.
  const [gh, rel] = await Promise.all([
    token && (reads.length || hive) ? briefly("github", loadGitHub()) : null,
    token ? briefly("releases", loadReleases()) : null,
  ]);
  if (gh?.github) {
    const merge = reads.includes("merge") && mergeRow(gh.github);
    if (merge) rows.push(merge);
    const blocked = reads.includes("blocked") && blockedRow(gh.github);
    if (blocked) rows.push(blocked);
    if (hive) {
      const now = Math.floor(Date.now() / 1000);
      try {
        const buckets = await recentBuckets(now, 24);
        for (const q of quietAgents(hive, feed, gh.github, buckets)) {
          if (now - q.since > HEADS_UP_QUIET_S) {
            headsUp.push(quietLine(q, now));
          }
        }
      } catch (err) {
        console.error("Needs you, silence:", err);
      }
    }
  } else if (gh && reads.length) {
    failures.push({
      source: "GitHub",
      detail: `${gh.error}, so ${reads.map((r) => GITHUB_READS[r]).join(" and ")} can't load.`,
    });
  }
  if (rel?.releases) {
    const release = releaseRow(rel.releases);
    const ci = ciRow(rel.releases);
    if (release) rows.push(release);
    if (ci) rows.push(ci);
  } else if (rel) {
    failures.push({
      source: "GitHub",
      detail: `${rel.error}, so releases and CI on main can't load.`,
    });
  }
  try {
    const health = await loadFailing(Math.floor(Date.now() / 1000));
    if (health)
      rows.push(...health.failing.map((f) => failingRow(f, health.source)));
  } catch (err) {
    // Like the cost chip: a database outage shows on Health, not every page.
    console.error("Needs you, Health:", err);
  }
  // ponytail: the card stays disconnected rather than a stubbed "All clear",
  // but still lists the rows it can see.
  return {
    connected: false,
    rows,
    headsUp,
    failures,
    updatedAt,
  };
});
