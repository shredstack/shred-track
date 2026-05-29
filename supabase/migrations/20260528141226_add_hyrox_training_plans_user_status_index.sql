-- Index supporting the hot lookup on /api/hyrox/plan and related routes:
--   where user_id = $1 and status = 'active' order by created_at desc limit 1
-- Without this, the planner falls back to a scan + sort once the table grows,
-- which is the same query that hit Postgres' statement_timeout during the
-- 2026-05-28 production stall. `created_at DESC` is included so the ORDER BY
-- can be served from the index without a separate sort step.
CREATE INDEX IF NOT EXISTS hyrox_training_plans_user_status_created_idx
  ON hyrox_training_plans (user_id, status, created_at DESC);
