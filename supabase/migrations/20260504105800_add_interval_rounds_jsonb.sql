-- Per-round work/rest array for the "intervals" workout type. Replaces
-- the single-pair `interval_work_seconds` / `interval_rest_seconds`
-- columns when set; legacy columns are retained as a fallback for one
-- release. Shape:
--   [
--     { "workSeconds": 240, "restSeconds": 240 },
--     { "workSeconds": 180, "restSeconds": 180 },
--     { "workSeconds": 120, "restSeconds": 120 }
--   ]

ALTER TABLE workout_parts
  ADD COLUMN IF NOT EXISTS interval_rounds JSONB;

COMMENT ON COLUMN workout_parts.interval_rounds IS
  'Per-round work/rest array for the "intervals" workout type. Falls back to interval_work_seconds / interval_rest_seconds applied uniformly when null.';
