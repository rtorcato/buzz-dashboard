-- Rollback for 0006_projects (#166). Never run automatically.
--
-- 0006 is purely additive, so rolling back the app is usually enough: older
-- builds ignore these tables. Run this only if the tables themselves must go.
-- It drops the owner's edits and the audit trail, so back up first:
--
--   pg_dump "$DATABASE_URL" -t projects -t project_repos -t project_agents \
--     -t channel_assignments -t registry_revisions > registry-backup.sql
--
-- Then find 0006's hash (the newest row) and put it in the last statement:
--
--   SELECT id, hash, created_at FROM drizzle.__drizzle_migrations
--   ORDER BY created_at DESC LIMIT 1;

BEGIN;
DROP INDEX IF EXISTS cost_points_channel_at_idx, events_channel_at_idx, events_repo_at_idx;
DROP TABLE IF EXISTS registry_revisions, project_agents, channel_assignments, project_repos, projects;
DELETE FROM drizzle.__drizzle_migrations WHERE hash = '<0006 hash>';
COMMIT;
