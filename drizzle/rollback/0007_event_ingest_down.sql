-- Rollback for 0007_event_ingest (#199). Never run automatically.
--
-- 0007 is additive. Rolling back the app is usually enough. This drops the
-- per-platform tokens (revoking every platform) and the two new columns, so
-- back up first:
--
--   pg_dump "$DATABASE_URL" -t ingest_tokens > ingest-tokens-backup.sql
--   psql "$DATABASE_URL" -c "\copy (SELECT * FROM events WHERE source = 'ingest') TO 'ingest-events.csv' CSV HEADER"
--
-- Find 0007's hash (the newest row) and put it in the last statement:
--
--   SELECT id, hash, created_at FROM drizzle.__drizzle_migrations
--   ORDER BY created_at DESC LIMIT 1;

BEGIN;
DROP TABLE IF EXISTS ingest_tokens;
DROP INDEX IF EXISTS events_ingest_kind_at_idx, events_ingest_agent_at_idx;
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_ingest_ck;
DELETE FROM events WHERE source = 'ingest';   -- their identity lives in the columns below
ALTER TABLE events DROP COLUMN IF EXISTS agent_id, DROP COLUMN IF EXISTS platform;
DELETE FROM drizzle.__drizzle_migrations WHERE hash = '<0007 hash>';
COMMIT;
