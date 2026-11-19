CREATE TABLE "needs_you_log" (
	"key" text NOT NULL,
	"rule" text NOT NULL,
	"title" text NOT NULL,
	"appeared_at" timestamp with time zone NOT NULL,
	"cleared_at" timestamp with time zone,
	"acked" boolean DEFAULT false NOT NULL,
	"hive" text,
	CONSTRAINT "needs_you_log_key_appeared_at_pk" PRIMARY KEY("key","appeared_at")
);
--> statement-breakpoint
CREATE INDEX "needs_you_log_cleared_idx" ON "needs_you_log" USING btree ("cleared_at");