CREATE TABLE "channel_assignments" (
	"hive" text NOT NULL,
	"channel_id" text NOT NULL,
	"scope" text NOT NULL,
	"project_id" uuid,
	"is_home" boolean DEFAULT false NOT NULL,
	"label" text,
	"assigned_by" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "channel_assignments_hive_channel_id_pk" PRIMARY KEY("hive","channel_id"),
	CONSTRAINT "channel_assignments_scope_ck" CHECK ("channel_assignments"."scope" IN ('project','hive_wide')),
	CONSTRAINT "channel_assignments_project_ck" CHECK (("channel_assignments"."scope" = 'project') = ("channel_assignments"."project_id" IS NOT NULL)),
	CONSTRAINT "channel_assignments_home_ck" CHECK (NOT "channel_assignments"."is_home" OR "channel_assignments"."scope" = 'project'),
	CONSTRAINT "channel_assignments_assigned_by_ck" CHECK ("channel_assignments"."assigned_by" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "project_agents" (
	"hive" text NOT NULL,
	"project_id" uuid NOT NULL,
	"agent_pubkey" text NOT NULL,
	"role" text,
	CONSTRAINT "project_agents_hive_project_id_agent_pubkey_pk" PRIMARY KEY("hive","project_id","agent_pubkey"),
	CONSTRAINT "project_agents_pubkey_ck" CHECK ("project_agents"."agent_pubkey" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "project_repos" (
	"hive" text NOT NULL,
	"repo" text NOT NULL,
	"project_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "project_repos_hive_repo_pk" PRIMARY KEY("hive","repo"),
	CONSTRAINT "project_repos_repo_ck" CHECK ("project_repos"."repo" = lower("project_repos"."repo") AND "project_repos"."repo" ~ '^[a-z0-9._-]+/[a-z0-9._-]+$')
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hive" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"short_label" text,
	"release_model" text DEFAULT 'unknown' NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"dev_branch" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_slug_ck" CHECK ("projects"."slug" ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
	CONSTRAINT "projects_release_model_ck" CHECK ("projects"."release_model" IN ('changesets','milestone','app_dev','none','unknown')),
	CONSTRAINT "projects_dev_branch_ck" CHECK ("projects"."release_model" <> 'app_dev' OR "projects"."dev_branch" IS NOT NULL),
	CONSTRAINT "projects_short_label_ck" CHECK ("projects"."short_label" ~ '^[A-Z0-9]{1,3}$')
);
--> statement-breakpoint
CREATE TABLE "registry_revisions" (
	"event_id" text PRIMARY KEY NOT NULL,
	"hive" text NOT NULL,
	"project_id" uuid,
	"channel_id" text,
	"revision" integer NOT NULL,
	"signer_pubkey" text NOT NULL,
	"note" text,
	"change" jsonb NOT NULL,
	"signed_event" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registry_revisions_event_id_ck" CHECK ("registry_revisions"."event_id" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "registry_revisions_target_ck" CHECK ("registry_revisions"."project_id" IS NOT NULL OR "registry_revisions"."channel_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "channel_assignments" ADD CONSTRAINT "channel_assignments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_agents" ADD CONSTRAINT "project_agents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repos" ADD CONSTRAINT "project_repos_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registry_revisions" ADD CONSTRAINT "registry_revisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_assignments_project_idx" ON "channel_assignments" USING btree ("project_id") WHERE "channel_assignments"."project_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_assignments_one_home_uq" ON "channel_assignments" USING btree ("project_id") WHERE "channel_assignments"."is_home";--> statement-breakpoint
CREATE INDEX "channel_assignments_hive_wide_idx" ON "channel_assignments" USING btree ("hive") WHERE "channel_assignments"."scope" = 'hive_wide';--> statement-breakpoint
CREATE INDEX "project_agents_agent_idx" ON "project_agents" USING btree ("hive","agent_pubkey");--> statement-breakpoint
CREATE INDEX "project_repos_project_idx" ON "project_repos" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_repos_one_primary_uq" ON "project_repos" USING btree ("project_id") WHERE "project_repos"."is_primary";--> statement-breakpoint
CREATE UNIQUE INDEX "projects_hive_slug_uq" ON "projects" USING btree ("hive","slug");--> statement-breakpoint
CREATE INDEX "projects_hive_live_idx" ON "projects" USING btree ("hive","sort_order") WHERE "projects"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "registry_revisions_project_rev_uq" ON "registry_revisions" USING btree ("project_id","revision") WHERE "registry_revisions"."channel_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "registry_revisions_channel_rev_uq" ON "registry_revisions" USING btree ("hive","channel_id","revision") WHERE "registry_revisions"."channel_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "registry_revisions_hive_time_idx" ON "registry_revisions" USING btree ("hive","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cost_points_channel_at_idx" ON "cost_points" USING btree ("channel","at") WHERE "cost_points"."channel" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_repo_at_idx" ON "events" USING btree (lower("repo"),"at" DESC NULLS LAST) WHERE "events"."repo" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_channel_at_idx" ON "events" USING btree ("channel","at" DESC NULLS LAST) WHERE "events"."channel" IS NOT NULL;