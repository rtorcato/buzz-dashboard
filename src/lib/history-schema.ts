import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// The relay a row came from (#116), for multi-hive (#74) later. Not in any key
// yet. migrateHistory makes BUZZ_RELAY_URL the default and fills old rows, so
// no insert has to set it.
const hive = () => text("hive");

// The history store (#39). One append-only table of events from the sources
// the dashboard already reads. `pnpm db:generate` turns a change here into a
// new migration under drizzle/; the server applies it on start.
export const events = pgTable(
  "events",
  {
    /** "github" or "buzz". */
    source: text("source").notNull(),
    /** Unique per source: a Nostr event id, or "owner/repo#12:merged". */
    sourceId: text("source_id").notNull(),
    /** "message", "pr_opened", "pr_merged", "pr_closed" or "claimed". */
    kind: text("kind").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    /** The agent's name when known, else a GitHub login or a hex pubkey. */
    actor: text("actor"),
    /** "owner/name" for GitHub events. */
    repo: text("repo"),
    /** Buzz channel id (the `h` tag). */
    channel: text("channel"),
    /** PR or issue title. */
    title: text("title"),
    url: text("url"),
    /** Message text. */
    body: text("body"),
    /** Source-specific extras, e.g. a PR's labels and number. */
    data: jsonb("data").$type<Record<string, unknown>>(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    hive: hive(),
  },
  // The primary key makes ingest idempotent: a re-read inserts nothing new.
  (t) => [
    primaryKey({ columns: [t.source, t.sourceId] }),
    index("events_at_idx").on(t.at),
    // #166: the project page and filters read events by repo or channel.
    index("events_repo_at_idx")
      .on(sql`lower(${t.repo})`, t.at.desc())
      .where(sql`${t.repo} IS NOT NULL`),
    index("events_channel_at_idx")
      .on(t.channel, t.at.desc())
      .where(sql`${t.channel} IS NOT NULL`),
  ],
);

export type HistoryEvent = typeof events.$inferSelect;
export type NewHistoryEvent = typeof events.$inferInsert;

// Cost reports from Claude Code OpenTelemetry (#42): one row per delta data
// point of claude_code.cost.usage or claude_code.token.usage. The key drops a
// point the exporter retries. The owner signer (#43) writes the same rows from
// Buzz's per-turn reports, with the turn's event id as the series.
export const costPoints = pgTable(
  "cost_points",
  {
    at: timestamp("at", { withTimezone: true }).notNull(),
    /** The `agent` resource attribute, its Buzz display name. */
    agent: text("agent").notNull(),
    model: text("model").notNull(),
    /** "cost" (USD at list price) or "tokens". */
    metric: text("metric").notNull(),
    /** Token type: input, output, cacheRead or cacheCreation; "" for cost. */
    type: text("type").notNull(),
    /**
     * A hash of the point's other attributes (session.id, query_source and
     * so on), so two series reported at the same instant both count.
     */
    series: text("series").notNull(),
    value: doublePrecision("value").notNull(),
    /** The turn's Buzz channel id; only the owner signer's reports (#43) have one. */
    channel: text("channel"),
    hive: hive(),
  },
  (t) => [
    primaryKey({
      columns: [t.agent, t.series, t.model, t.metric, t.type, t.at],
    }),
    index("cost_points_at_idx").on(t.at),
    index("cost_points_channel_at_idx")
      .on(t.channel, t.at)
      .where(sql`${t.channel} IS NOT NULL`),
  ],
);

export type NewCostPoint = typeof costPoints.$inferInsert;

// Health (#44): one row per API request or failed request from Claude Code
// OpenTelemetry logs, or per turn from the owner signer's reports (#43). Only
// what the rates need; never a prompt, a response or an error message.
export const agentEvents = pgTable(
  "agent_events",
  {
    /** A hash of the OTel log record, or the turn report's event id. */
    id: text("id").primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    agent: text("agent").notNull(),
    model: text("model").notNull(),
    /** "request" or "error" from OTel, "turn" from the owner signer. */
    kind: text("kind").notNull(),
    /** A turn's NIP-AM stopReason: end_turn, max_tokens, cancelled, error or unknown. */
    reason: text("reason"),
    /** An OTel api_error's HTTP status code. */
    status: integer("status"),
    hive: hive(),
  },
  (t) => [index("agent_events_at_idx").on(t.at)],
);

export type NewAgentEvent = typeof agentEvents.$inferInsert;

// The dashboard's own state that only the owner changes (#40), as key/value.
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  hive: hive(),
});

// Needs you cleared-items log (#88): when each alert item appeared and when it
// cleared, written by the alerts pass. Feeds the card footer's weekly stats
// and the History table. An item that comes back gets a new row.
export const needsYouLog = pgTable(
  "needs_you_log",
  {
    /** The alert item key, e.g. "failing:Gale" or "merge:repo#12". */
    key: text("key").notNull(),
    /** The alert rule: "failing" or "merge" so far. */
    rule: text("rule").notNull(),
    title: text("title").notNull(),
    appearedAt: timestamp("appeared_at", { withTimezone: true }).notNull(),
    /** Null while the item is still showing. */
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
    /** The owner acked it (snooze until it changes) before it cleared. */
    acked: boolean("acked").notNull().default(false),
    hive: hive(),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.appearedAt] }),
    index("needs_you_log_cleared_idx").on(t.clearedAt),
  ],
);

// The project registry (#166), to Devastator's schema on the issue. Unlike the
// tables above, `hive` is NOT NULL and in every key: one repo or channel
// belongs to at most one project per hive. Projects are archived, never
// deleted, so their revision log stays.
const liveHive = () => text("hive").notNull();

export const RELEASE_MODELS = [
  "changesets",
  "milestone",
  "app_dev",
  "none",
  "unknown",
] as const;
export type ReleaseModel = (typeof RELEASE_MODELS)[number];

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hive: liveHive(),
    /** URL key: /projects/<slug>, ?project=<slug>. */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** The tile's 1-3 letters, e.g. "DB"; null derives it from the slug. */
    shortLabel: text("short_label"),
    releaseModel: text("release_model")
      .$type<ReleaseModel>()
      .notNull()
      .default("unknown"),
    defaultBranch: text("default_branch").notNull().default("main"),
    /** Set for app_dev. */
    devBranch: text("dev_branch"),
    sortOrder: integer("sort_order").notNull().default(0),
    /** 0 = seeded; each signed edit bumps it. */
    revision: integer("revision").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("projects_hive_slug_uq").on(t.hive, t.slug),
    index("projects_hive_live_idx")
      .on(t.hive, t.sortOrder)
      .where(sql`${t.archivedAt} IS NULL`),
    check("projects_slug_ck", sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{0,62}$'`),
    check(
      "projects_release_model_ck",
      sql`${t.releaseModel} IN ('changesets','milestone','app_dev','none','unknown')`,
    ),
    check(
      "projects_dev_branch_ck",
      sql`${t.releaseModel} <> 'app_dev' OR ${t.devBranch} IS NOT NULL`,
    ),
    check("projects_short_label_ck", sql`${t.shortLabel} ~ '^[A-Z0-9]{1,3}$'`),
  ],
);

export const projectRepos = pgTable(
  "project_repos",
  {
    hive: liveHive(),
    /** "owner/name", lowercase, as in events.repo. */
    repo: text("repo").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references((): AnyPgColumn => projects.id, { onDelete: "cascade" }),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.hive, t.repo] }),
    index("project_repos_project_idx").on(t.projectId),
    uniqueIndex("project_repos_one_primary_uq")
      .on(t.projectId)
      .where(sql`${t.isPrimary}`),
    check(
      "project_repos_repo_ck",
      sql`${t.repo} = lower(${t.repo}) AND ${t.repo} ~ '^[a-z0-9._-]+/[a-z0-9._-]+$'`,
    ),
  ],
);

export const CHANNEL_SCOPES = ["project", "hive_wide"] as const;
export type ChannelScope = (typeof CHANNEL_SCOPES)[number];

// A channel is in a project, hive-wide, or unassigned (no row).
export const channelAssignments = pgTable(
  "channel_assignments",
  {
    hive: liveHive(),
    /** Relay channel id, the `h` tag. */
    channelId: text("channel_id").notNull(),
    scope: text("scope").$type<ChannelScope>().notNull(),
    projectId: uuid("project_id").references((): AnyPgColumn => projects.id, {
      onDelete: "cascade",
    }),
    isHome: boolean("is_home").notNull().default(false),
    /** The owner's name for a channel the dashboard can't read. */
    label: text("label"),
    /** The signer's pubkey; seeded rows carry the dashboard's own key. */
    assignedBy: text("assigned_by").notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revision: integer("revision").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.hive, t.channelId] }),
    index("channel_assignments_project_idx")
      .on(t.projectId)
      .where(sql`${t.projectId} IS NOT NULL`),
    uniqueIndex("channel_assignments_one_home_uq")
      .on(t.projectId)
      .where(sql`${t.isHome}`),
    index("channel_assignments_hive_wide_idx")
      .on(t.hive)
      .where(sql`${t.scope} = 'hive_wide'`),
    check(
      "channel_assignments_scope_ck",
      sql`${t.scope} IN ('project','hive_wide')`,
    ),
    check(
      "channel_assignments_project_ck",
      sql`(${t.scope} = 'project') = (${t.projectId} IS NOT NULL)`,
    ),
    check(
      "channel_assignments_home_ck",
      sql`NOT ${t.isHome} OR ${t.scope} = 'project'`,
    ),
    check(
      "channel_assignments_assigned_by_ck",
      sql`${t.assignedBy} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const projectAgents = pgTable(
  "project_agents",
  {
    hive: liveHive(),
    projectId: uuid("project_id")
      .notNull()
      .references((): AnyPgColumn => projects.id, { onDelete: "cascade" }),
    agentPubkey: text("agent_pubkey").notNull(),
    /** Free text: "coder", "reviewer". */
    role: text("role"),
  },
  (t) => [
    primaryKey({ columns: [t.hive, t.projectId, t.agentPubkey] }),
    index("project_agents_agent_idx").on(t.hive, t.agentPubkey),
    check("project_agents_pubkey_ck", sql`${t.agentPubkey} ~ '^[0-9a-f]{64}$'`),
  ],
);

// Who changed what: one row per signed edit, to a project or a channel.
export const registryRevisions = pgTable(
  "registry_revisions",
  {
    /** The signed event's id, so a replay fails on the key. */
    eventId: text("event_id").primaryKey(),
    hive: liveHive(),
    projectId: uuid("project_id").references((): AnyPgColumn => projects.id, {
      onDelete: "restrict",
    }),
    channelId: text("channel_id"),
    revision: integer("revision").notNull(),
    signerPubkey: text("signer_pubkey").notNull(),
    note: text("note"),
    /** {before, after} of the fields and links that changed. */
    change: jsonb("change").$type<Record<string, unknown>>().notNull(),
    /** The full event with its signature, so it can be verified again. */
    signedEvent: jsonb("signed_event")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("registry_revisions_project_rev_uq")
      .on(t.projectId, t.revision)
      .where(sql`${t.channelId} IS NULL`),
    uniqueIndex("registry_revisions_channel_rev_uq")
      .on(t.hive, t.channelId, t.revision)
      .where(sql`${t.channelId} IS NOT NULL`),
    index("registry_revisions_hive_time_idx").on(t.hive, t.createdAt.desc()),
    check(
      "registry_revisions_event_id_ck",
      sql`${t.eventId} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "registry_revisions_target_ck",
      sql`${t.projectId} IS NOT NULL OR ${t.channelId} IS NOT NULL`,
    ),
  ],
);

export type Project = typeof projects.$inferSelect;
