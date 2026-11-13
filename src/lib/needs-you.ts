import { connection } from "next/server";
import { cache } from "react";
import { type GitHub, loadGitHub } from "./github";
import type { FailingAgent, HealthSource } from "./health";
import { loadFailing } from "./health-data";
import { loadHive } from "./hive";
import { sampleMergeRow, sampleMode } from "./sample-data";
import { loadStatusFeed, type StatusFeed } from "./status-feed";
import { trippedDetail, usageState } from "./usage";

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
};

// Alert item keys, shared by the rows and the alerts pass.
export const failingKey = (agent: string) => `failing:${agent}`;
export const mergeKey = (pr: { repo: string; number: number }) =>
  `merge:${pr.repo}#${pr.number}`;

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

export function oldestFirst(rows: NeedsYouRow[]): NeedsYouRow[] {
  return rows.toSorted((a, b) => a.since.localeCompare(b.since));
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

export const MERGE_READY = "merge-ready";

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
  const oldest = Math.min(...prs.map((p) => p.createdAt));
  return {
    kind: "merge",
    title: `${prs.length} PR${prs.length > 1 ? "s" : ""} ready to merge`,
    detail: prs.map((p) => `${p.repo.split("/")[1]}#${p.number}`).join(", "),
    count: prs.length,
    since: new Date(oldest * 1000).toISOString(),
    keys: prs.map(mergeKey),
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
  } satisfies NeedsYouRow;
}

// A cold GitHub read takes about 20s. The card doesn't hold every page for it;
// the read carries on and the next request shows the row.
const GITHUB_WAIT_MS = 2_000;

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

/** The "owner/repo#N" refs of GitHub items that need the owner, for row tints. */
export const needsYouRefs = (data: NeedsYou) =>
  new Set(
    data.rows.flatMap((r) =>
      (r.keys ?? []).flatMap((k) => k.match(/^merge:(.+#\d+)$/)?.[1] ?? []),
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
  if (!failures.some((f) => f.source === RELAY)) {
    const result = await loadHive();
    if (result.hive) updatedAt = result.fetchedAt;
    else {
      failures.push({
        source: RELAY,
        detail: `${result.error}, so Agents and Timeline can't load.`,
      });
    }
  }
  const rows: NeedsYouRow[] = [];
  const paused = pausedRow((await loadStatusFeed()).feed, Date.now() / 1000);
  if (paused) rows.push(paused);
  const excluded = excludedLabels(process.env.NEEDS_YOU_EXCLUDE_LABELS);
  if (process.env.GITHUB_TOKEN && !excluded.has(MERGE_READY)) {
    const result = await Promise.race([
      loadGitHub(),
      new Promise<null>((r) => setTimeout(r, GITHUB_WAIT_MS, null)),
    ]);
    if (result?.github) {
      const merge = mergeRow(result.github);
      if (merge) rows.push(merge);
    } else if (result) {
      failures.push({
        source: "GitHub",
        detail: `${result.error}, so merge-ready PRs can't load.`,
      });
    }
  }
  try {
    const health = await loadFailing(Math.floor(Date.now() / 1000));
    if (health)
      rows.push(...health.failing.map((f) => failingRow(f, health.source)));
  } catch (err) {
    // Like the cost chip: a database outage shows on Health, not every page.
    console.error("Needs you, Health:", err);
  }
  // ponytail: only the usage pause, merge-ready and failing agents are read
  // so far. The
  // Pipeline PR adds ai-blocked issues and the Releases PR adds release
  // approvals and red CI on main. Until then the card stays disconnected
  // rather than a stubbed "All clear", but still lists the rows it can see.
  return {
    connected: false,
    rows,
    headsUp: [],
    failures,
    updatedAt,
  };
});
