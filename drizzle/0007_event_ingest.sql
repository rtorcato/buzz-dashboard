CREATE TABLE "ingest_tokens" (
	"hive" text NOT NULL,
	"platform" text NOT NULL,
	"hash" text NOT NULL,
	"last4" text NOT NULL,
	"link_hosts" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingest_tokens_hive_platform_pk" PRIMARY KEY("hive","platform"),
	CONSTRAINT "ingest_tokens_platform_ck" CHECK ("ingest_tokens"."platform" ~ '^[a-z0-9][a-z0-9-]{0,31}$'),
	CONSTRAINT "ingest_tokens_hash_ck" CHECK ("ingest_tokens"."hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ingest_tokens_link_hosts_ck" CHECK (cardinality("ingest_tokens"."link_hosts") <= 32)
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "platform" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "agent_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "ingest_tokens_hash_uq" ON "ingest_tokens" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "events_ingest_kind_at_idx" ON "events" USING btree ("kind","at" DESC NULLS LAST) WHERE "events"."source" = 'ingest';--> statement-breakpoint
CREATE INDEX "events_ingest_platform_at_idx" ON "events" USING btree ("platform","at" DESC NULLS LAST) WHERE "events"."source" = 'ingest';--> statement-breakpoint
CREATE INDEX "events_ingest_agent_at_idx" ON "events" USING btree ("platform","agent_id","at" DESC NULLS LAST) WHERE "events"."source" = 'ingest';--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_ingest_ck" CHECK ("events"."source" <> 'ingest' OR (
        "events"."platform" IS NOT NULL AND "events"."agent_id" IS NOT NULL
        AND "events"."platform" ~ '^[a-z0-9][a-z0-9-]{0,31}$'
        AND "events"."agent_id" ~ '^[[:graph:]]{1,128}$'
        AND "events"."kind" ~ '^[a-z][a-z0-9_]{0,47}$'
        AND starts_with("events"."source_id", "events"."platform" || ':') AND char_length("events"."source_id") <= 161
        AND "events"."actor" IS NOT NULL AND char_length("events"."actor") BETWEEN 1 AND 64
        AND "events"."title" IS NOT NULL AND char_length("events"."title") BETWEEN 1 AND 200
        AND ("events"."body" IS NULL OR char_length("events"."body") <= 4000)
        AND ("events"."url" IS NULL OR ("events"."url" ~ '^https://' AND char_length("events"."url") <= 2048))
        AND ("events"."repo" IS NULL OR ("events"."repo" = lower("events"."repo") AND "events"."repo" ~ '^[a-z0-9._-]+/[a-z0-9._-]+$'))
      ));