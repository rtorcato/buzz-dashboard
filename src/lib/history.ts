import "server-only";

import path from "node:path";
import { where } from "@rtorcato/db-common";
import { toDrizzleWhere } from "@rtorcato/db-drizzle";
import { createDb, type DbHandle } from "@rtorcato/db-drizzle/connection";
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  max,
  min,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { LogRow, OpenRow } from "./cleared-log";
import { FLOW_KINDS } from "./flow";
import type { HealthBucket } from "./health";
import {
  agentEvents,
  costPoints,
  events,
  type HistoryEvent,
  ingestTokens,
  type NewAgentEvent,
  type NewCostPoint,
  needsYouLog,
  settings,
} from "./history-schema";

// The optional history store (#39). Without DATABASE_URL the dashboard is the
// live-only view: historyEnabled() is false and nothing here opens a
// connection. The history views (#41 to #47) read through listEvents and
// historyStats.

const schema = {
  events,
  costPoints,
  agentEvents,
  needsYouLog,
  settings,
  ingestTokens,
};
type Db = DbHandle<typeof schema>["db"];

/** True when DATABASE_URL is set, so the history views and nav show. */
export const historyEnabled = () => Boolean(process.env.DATABASE_URL);

const DEFAULT_RETENTION_DAYS = 90;

/** HISTORY_RETENTION_DAYS, a whole number of days; 90 when unset or invalid. */
export function retentionDays(raw = process.env.HISTORY_RETENTION_DAYS) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_RETENTION_DAYS;
}

let handle: DbHandle<typeof schema> | undefined;

/** The shared pool. Throws when DATABASE_URL is unset; check historyEnabled(). */
export function historyDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // A timeout so an unreachable host can't hang the server start.
  handle ??= createDb(
    { connectionString: url, max: 5, connectionTimeoutMillis: 10_000 },
    schema,
  );
  return handle.db;
}

/** Applies any pending migrations from drizzle/. Safe to run on every start. */
export async function migrateHistory() {
  // The Docker image copies drizzle/ next to server.js, which is the cwd.
  await migrate(historyDb(), {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });
  for (const statement of hiveStatements(process.env.BUZZ_RELAY_URL)) {
    await historyDb().execute(sql.raw(statement));
  }
}

const HIVE_TABLES = [
  "events",
  "cost_points",
  "agent_events",
  "needs_you_log",
  "settings",
  // #166: NOT NULL and in every key, so the default only saves naming it.
  "projects",
  "project_repos",
  "channel_assignments",
  "project_agents",
  "registry_revisions",
  // #199: NOT NULL and in the key, like the registry tables.
  "ingest_tokens",
];

/**
 * #116: the relay URL becomes each history table's `hive` default, and rows
 * without one get it, so no insert has to name the hive. [] without a relay.
 */
export function hiveStatements(relayUrl: string | undefined): string[] {
  let url: URL;
  try {
    url = new URL(relayUrl ?? "");
  } catch {
    return [];
  }
  if (url.protocol !== "wss:" && url.protocol !== "ws:") return [];
  // ALTER ... SET DEFAULT takes no bind parameters, so quote it as a literal.
  const hive = `'${url.href.replace(/'/g, "''")}'`;
  return HIVE_TABLES.flatMap((t) => [
    `ALTER TABLE "${t}" ALTER COLUMN "hive" SET DEFAULT ${hive}`,
    `UPDATE "${t}" SET "hive" = ${hive} WHERE "hive" IS NULL`,
  ]);
}

/** Deletes rows past the retention window; returns how many. */
export async function pruneHistory(now = new Date()) {
  const cutoff = new Date(now.getTime() - retentionDays() * 86_400_000);
  const results = await Promise.all([
    historyDb().delete(events).where(lt(events.at, cutoff)),
    historyDb().delete(costPoints).where(lt(costPoints.at, cutoff)),
    historyDb().delete(agentEvents).where(lt(agentEvents.at, cutoff)),
    historyDb().delete(needsYouLog).where(lt(needsYouLog.appearedAt, cutoff)),
  ]);
  return results.reduce((n, r) => n + (r.rowCount ?? 0), 0);
}

export type EventQuery = {
  /** Inclusive. */
  since?: Date;
  /** Exclusive. */
  until?: Date;
  source?: "github" | "buzz" | "ingest";
  kinds?: string[];
  /** #199: ingested events from any of these platforms. */
  platforms?: string[];
  /** #199: ingested events from any of these platform agent ids. */
  agentIds?: string[];
  repo?: string;
  /** Any of these actors: an agent's name and its pubkeys. */
  actors?: string[];
  channel?: string;
  /**
   * A project's repos and channels (#167): events in any of those repos or
   * channels. Needs `since`, so the repo and channel indexes (#166) bound the
   * read.
   */
  project?: ProjectFilter;
  /** Case-insensitive substring of the title, body or repo. */
  text?: string;
  /** Default 100, at most 1000. */
  limit?: number;
};

/** A project's repos (lowercase "owner/name") and Buzz channel ids. */
export type ProjectFilter = { repos: string[]; channels: string[] };

/**
 * `lower(repo) = ANY(repos) OR channel = ANY(channels)`: each side matches an
 * index on the events table (events_repo_at_idx, events_channel_at_idx). A
 * project with neither matches nothing.
 */
export function projectCondition(p: ProjectFilter): SQL {
  const repos = p.repos.length
    ? sql`lower(${events.repo}) = ANY(${sql.param(p.repos)}::text[])`
    : undefined;
  const channels = p.channels.length
    ? sql`${events.channel} = ANY(${sql.param(p.channels)}::text[])`
    : undefined;
  return or(repos, channels) ?? sql`false`;
}

const COLS = {
  at: events.at,
  source: events.source,
  kind: events.kind,
  repo: events.repo,
  actor: events.actor,
  channel: events.channel,
  platform: events.platform,
  agentId: events.agentId,
};

// Every filter in `q` as one condition; limit is not a filter.
function matching(q: EventQuery): SQL | undefined {
  const filter = Object.fromEntries(
    Object.entries({
      at: { gte: q.since, lt: q.until },
      source: q.source,
      kind: q.kinds && { in: q.kinds },
      repo: q.repo,
      actor: q.actors && { in: q.actors },
      channel: q.channel,
      platform: q.platforms && { in: q.platforms },
      agentId: q.agentIds && { in: q.agentIds },
    }).filter(([, v]) => v !== undefined),
  );
  // where() keeps undefined operator values, so drop them per column.
  const conds = where(filter).filter((c) => c.val !== undefined);
  if (q.project && !q.since) {
    throw new Error("a project-scoped event query needs a since");
  }
  const text = q.text?.trim();
  // Escape LIKE wildcards so "50%" matches itself.
  const like = text && `%${text.replace(/[\\%_]/g, "\\$&")}%`;
  return and(
    toDrizzleWhere(conds, COLS),
    q.project ? projectCondition(q.project) : undefined,
    like
      ? or(
          ilike(events.title, like),
          ilike(events.body, like),
          ilike(events.repo, like),
        )
      : undefined,
  );
}

/** Stored events matching every given filter, newest first. */
export function listEvents(q: EventQuery = {}): Promise<HistoryEvent[]> {
  return historyDb()
    .select()
    .from(events)
    .where(matching(q))
    .orderBy(desc(events.at), desc(events.sourceId))
    .limit(Math.min(Math.max(q.limit ?? 100, 1), 1000));
}

/**
 * Every stored PR event since `since`, oldest first, for the Pipeline flow
 * (#47). Only the columns it reads, and no row limit: a PR needs all of its
 * events to be measured.
 */
export function prEvents(since: Date, project?: ProjectFilter) {
  // ponytail: a few thousand rows at 90 days and ~30 PRs a day. Aggregate in
  // SQL if the store grows past what one page load can sort.
  return historyDb()
    .select({
      kind: events.kind,
      at: events.at,
      actor: events.actor,
      repo: events.repo,
      title: events.title,
      url: events.url,
      data: events.data,
    })
    .from(events)
    .where(
      matching({ since, source: "github", kinds: [...FLOW_KINDS], project }),
    )
    .orderBy(events.at);
}

/**
 * How many events match, per day in `timeZone` (an IANA name), oldest first.
 * Days with no match are left out. For the Timeline's "Matches per day".
 */
export async function countEventsByDay(
  q: EventQuery,
  timeZone: string,
): Promise<{ day: Date; count: number }[]> {
  const day = sql<Date>`date_trunc('day', ${events.at}, ${timeZone})`;
  const rows = await historyDb()
    .select({ day, count: count() })
    .from(events)
    .where(matching(q))
    // By position: the time zone is a bound parameter, so repeating `day`
    // would be a different expression to Postgres.
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return rows.map((r) => ({ day: new Date(r.day), count: r.count }));
}

/** How many events match, for the Overview's previous-period deltas. */
export async function countEvents(q: EventQuery): Promise<number> {
  const [row] = await historyDb()
    .select({ count: count() })
    .from(events)
    .where(matching(q));
  return row?.count ?? 0;
}

/**
 * How many events match per weekday (0 = Sunday) and hour in `timeZone`, for
 * the Overview's "When the hive works" heatmap at 30d and 90d.
 */
export async function countEventsByWeekHour(
  q: EventQuery,
  timeZone: string,
): Promise<{ dow: number; hour: number; count: number }[]> {
  const local = sql`(${events.at} at time zone ${timeZone})`;
  const rows = await historyDb()
    .select({
      dow: sql<number>`extract(dow from ${local})`.mapWith(Number),
      hour: sql<number>`extract(hour from ${local})`.mapWith(Number),
      count: count(),
    })
    .from(events)
    .where(matching(q))
    // By position, as in countEventsByDay: the time zone is a parameter.
    .groupBy(sql`1`, sql`2`);
  return rows;
}

/** Every repo with a stored event, A to Z, for the repo filter. */
export async function historyRepos(): Promise<string[]> {
  const rows = await historyDb()
    .selectDistinct({ repo: events.repo })
    .from(events)
    .where(isNotNull(events.repo))
    .orderBy(events.repo);
  return rows.flatMap((r) => (r.repo ? [r.repo] : []));
}

export type HistoryStats = {
  events: number;
  /** How many of them came from Buzz. */
  buzz: number;
  /** The oldest stored event, or null when the store is empty. */
  since: Date | null;
  retentionDays: number;
};

/** For the "History from the database · since Sep 30" source lines. */
export async function historyStats(): Promise<HistoryStats> {
  const [row] = await historyDb()
    .select({
      events: count(),
      buzz: sql<number>`count(*) filter (where ${events.source} = 'buzz')`.mapWith(
        Number,
      ),
      since: min(events.at),
    })
    .from(events);
  return {
    events: row?.events ?? 0,
    buzz: row?.buzz ?? 0,
    since: row?.since ?? null,
    retentionDays: retentionDays(),
  };
}

/** A stored setting (#40: owner-only state), or null when unset. */
export async function getSetting(key: string): Promise<unknown> {
  const [row] = await historyDb()
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key));
  return row?.value ?? null;
}

export async function setSetting(key: string, value: unknown) {
  await historyDb()
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: new Date() },
    });
}

/**
 * Reads, changes and writes one setting under a lock on its key, so two
 * read-modify-writes can't lose each other's change (#90). Returns the new value.
 */
export async function updateSetting<T>(
  key: string,
  change: (value: unknown) => T,
): Promise<T> {
  return historyDb().transaction(async (tx) => {
    // An advisory lock rather than FOR UPDATE: it also covers a key not stored yet.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
    const [row] = await tx
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, key));
    const value = change(row?.value ?? null);
    await tx
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt: new Date() },
      });
    return value;
  });
}

export async function deleteSetting(key: string) {
  await historyDb().delete(settings).where(eq(settings.key, key));
}

/** Needs you items that showed and haven't cleared yet (#88). */
export async function openLogRows(): Promise<OpenRow[]> {
  const rows = await historyDb()
    .select()
    .from(needsYouLog)
    .where(isNull(needsYouLog.clearedAt));
  return rows.map((r) => ({
    key: r.key,
    appearedAt: r.appearedAt.getTime(),
    acked: r.acked,
  }));
}

/** Starts a log row per item; one already open for the key is left alone. */
export async function logAppeared(
  items: { key: string; rule: string; title: string }[],
  at: number,
) {
  if (!items.length) return;
  await historyDb()
    .insert(needsYouLog)
    .values(items.map((i) => ({ ...i, appearedAt: new Date(at) })))
    .onConflictDoNothing();
}

/** Marks the open rows for `keys` cleared. */
export async function logCleared(keys: string[], at: number) {
  if (!keys.length) return;
  await historyDb()
    .update(needsYouLog)
    .set({ clearedAt: new Date(at) })
    .where(and(inArray(needsYouLog.key, keys), isNull(needsYouLog.clearedAt)));
}

/** Marks the open rows for `keys` acked before they cleared. */
export async function logAcked(keys: string[]) {
  if (!keys.length) return;
  await historyDb()
    .update(needsYouLog)
    .set({ acked: true })
    .where(and(inArray(needsYouLog.key, keys), isNull(needsYouLog.clearedAt)));
}

/** Rows that cleared since `since`, newest first. */
export async function clearedSince(since: Date): Promise<LogRow[]> {
  const rows = await historyDb()
    .select()
    .from(needsYouLog)
    .where(
      and(isNotNull(needsYouLog.clearedAt), gte(needsYouLog.clearedAt, since)),
    )
    .orderBy(desc(needsYouLog.clearedAt));
  return rows.flatMap((r) =>
    r.clearedAt
      ? [
          {
            key: r.key,
            rule: r.rule,
            title: r.title,
            appearedAt: r.appearedAt.getTime(),
            clearedAt: r.clearedAt.getTime(),
            acked: r.acked,
          },
        ]
      : [],
  );
}

/** Stores cost points; a retried report inserts nothing new. */
export async function insertCostPoints(rows: NewCostPoint[]) {
  // Postgres takes at most 65,535 parameters a statement, 8 per row here.
  for (let i = 0; i < rows.length; i += 5000) {
    await historyDb()
      .insert(costPoints)
      .values(rows.slice(i, i + 5000))
      .onConflictDoNothing();
  }
}

export type CostRow = {
  /** Local midnight in `timeZone`. */
  day: Date;
  agent: string;
  model: string;
  metric: string;
  type: string;
  value: number;
};

/** Spend tagged with one of these channels (#167); the index is (channel, at). */
const inChannels = (channels: string[]): SQL =>
  channels.length
    ? sql`${costPoints.channel} = ANY(${sql.param(channels)}::text[])`
    : sql`false`;

/**
 * Cost and token sums since `since`, per day in `timeZone`, agent and model.
 * With `channels`, only spend tagged with one of them: untagged spend can't
 * be placed in a project, so a project's total never includes it.
 */
export async function costByDay(
  since: Date,
  timeZone: string,
  channels?: string[],
): Promise<CostRow[]> {
  // ponytail: sums raw delta points on every load. Roll them up into daily
  // rows if a 90-day range gets slow.
  const day = sql<Date>`date_trunc('day', ${costPoints.at}, ${timeZone})`;
  const rows = await historyDb()
    .select({
      day,
      agent: costPoints.agent,
      model: costPoints.model,
      metric: costPoints.metric,
      type: costPoints.type,
      value: sql<number>`sum(${costPoints.value})`.mapWith(Number),
    })
    .from(costPoints)
    .where(
      and(
        gte(costPoints.at, since),
        channels ? inChannels(channels) : undefined,
      ),
    )
    // By position, as in countEventsByDay: the time zone is a parameter.
    .groupBy(sql`1`, sql`2`, sql`3`, sql`4`, sql`5`);
  return rows.map((r) => ({ ...r, day: new Date(r.day) }));
}

/** Estimated dollars reported since `since`, for the header's cost chip. */
export async function costSince(since: Date): Promise<number> {
  const [row] = await historyDb()
    .select({
      value: sql<number>`coalesce(sum(${costPoints.value}), 0)`.mapWith(Number),
    })
    .from(costPoints)
    .where(and(gte(costPoints.at, since), eq(costPoints.metric, "cost")));
  return row?.value ?? 0;
}

/** Estimated dollars per agent since `since`, for the Agent over budget rule. */
export function costByAgentSince(since: Date) {
  return historyDb()
    .select({
      agent: costPoints.agent,
      usd: sql<number>`coalesce(sum(${costPoints.value}), 0)`.mapWith(Number),
    })
    .from(costPoints)
    .where(and(gte(costPoints.at, since), eq(costPoints.metric, "cost")))
    .groupBy(costPoints.agent);
}

/** Each agent that reported since `since`: its last report and tokens since `today`. */
export function costReporters(since: Date, today: Date) {
  return historyDb()
    .select({
      agent: costPoints.agent,
      last: max(costPoints.at),
      tokensToday:
        sql<number>`coalesce(sum(${costPoints.value}) filter (where ${costPoints.metric} = 'tokens' and ${costPoints.at} >= ${today}), 0)`.mapWith(
          Number,
        ),
    })
    .from(costPoints)
    .where(gte(costPoints.at, since))
    .groupBy(costPoints.agent);
}

/** The newest stored cost point's time, or null with none. */
export async function newestCostPoint(): Promise<Date | null> {
  const [row] = await historyDb()
    .select({ at: max(costPoints.at) })
    .from(costPoints);
  return row?.at ?? null;
}

/** Which of these series (turn event ids, for the owner signer) are stored. */
export async function knownSeries(ids: string[]): Promise<Set<string>> {
  const known = new Set<string>();
  // Well under Postgres's 65,535 parameters a statement.
  for (let i = 0; i < ids.length; i += 10_000) {
    const rows = await historyDb()
      .selectDistinct({ series: costPoints.series })
      .from(costPoints)
      .where(inArray(costPoints.series, ids.slice(i, i + 10_000)));
    for (const r of rows) known.add(r.series);
  }
  return known;
}

/** Estimated dollars since `since` with no channel tag: no project owns it. */
export async function costUntagged(since: Date): Promise<number> {
  const [row] = await historyDb()
    .select({
      value: sql<number>`coalesce(sum(${costPoints.value}), 0)`.mapWith(Number),
    })
    .from(costPoints)
    .where(
      and(
        gte(costPoints.at, since),
        eq(costPoints.metric, "cost"),
        isNull(costPoints.channel),
      ),
    );
  return row?.value ?? 0;
}

/**
 * Estimated dollars and turns per channel since `since`, costliest first; only
 * these `channels` when given (#167).
 */
export function costByChannel(since: Date, channels?: string[]) {
  return historyDb()
    .select({
      channel: costPoints.channel,
      cost: sql<number>`coalesce(sum(${costPoints.value}) filter (where ${costPoints.metric} = 'cost'), 0)`.mapWith(
        Number,
      ),
      turns: sql<number>`count(distinct ${costPoints.series})`.mapWith(Number),
    })
    .from(costPoints)
    .where(
      and(
        gte(costPoints.at, since),
        isNotNull(costPoints.channel),
        channels ? inChannels(channels) : undefined,
      ),
    )
    .groupBy(costPoints.channel)
    .orderBy(sql`2 desc`);
}

/** Stores Health events (#44); a retried report inserts nothing new. */
export async function insertAgentEvents(rows: NewAgentEvent[]) {
  // 7 parameters a row, well under Postgres's 65,535 a statement.
  for (let i = 0; i < rows.length; i += 5000) {
    await historyDb()
      .insert(agentEvents)
      .values(rows.slice(i, i + 5000))
      .onConflictDoNothing();
  }
}

/** Which of these turn event ids already have a Health row. */
export async function knownAgentEvents(ids: string[]): Promise<Set<string>> {
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += 10_000) {
    const rows = await historyDb()
      .select({ id: agentEvents.id })
      .from(agentEvents)
      .where(inArray(agentEvents.id, ids.slice(i, i + 10_000)));
    for (const r of rows) known.add(r.id);
  }
  return known;
}

/**
 * Health events since `since` of these kinds, counted per agent, 15-minute
 * slot, kind and reason. Small even at 7 days: at most 672 slots an agent.
 */
export async function healthBuckets(
  since: Date,
  kinds: string[],
): Promise<HealthBucket[]> {
  const slot = sql<number>`floor(extract(epoch from ${agentEvents.at}) / 900) * 900`;
  const rows = await historyDb()
    .select({
      agent: agentEvents.agent,
      slot: slot.mapWith(Number),
      kind: agentEvents.kind,
      reason: agentEvents.reason,
      count: count(),
      last: max(agentEvents.at),
    })
    .from(agentEvents)
    .where(and(gte(agentEvents.at, since), inArray(agentEvents.kind, kinds)))
    .groupBy(sql`1`, sql`2`, sql`3`, sql`4`);
  return rows.map((r) => ({
    ...r,
    last: r.last ? Math.floor(r.last.getTime() / 1000) : r.slot,
  }));
}

export type { HistoryEvent } from "./history-schema";
