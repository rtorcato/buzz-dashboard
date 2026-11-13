import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
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
