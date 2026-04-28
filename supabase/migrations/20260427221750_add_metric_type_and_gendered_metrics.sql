-- ============================================
-- Gendered RX metrics (Phase 1 of gendered_rx_and_rep_ladder_spec)
-- ============================================
--
-- Two changes:
--
-- 1) `movements.metric_type` — declares how the movement is measured. The
--    builder UI renders gender-split inputs based on this column ("weight"
--    shows lb pair; "calories" shows cal pair; "distance" shows m pair;
--    "reps" hides the metric pair entirely).
--
-- 2) Four new gender-split metric columns on `workout_movements` so that
--    "Row 12 (F) / 15 (M) cal" stops being unstructured free text and
--    becomes first-class structured data the score logger can decompose.
--
-- Backfill rules for `metric_type` (from §5.1 of the spec):
--   - monostructural row/ski/bike/echo  → 'calories'
--   - monostructural run                → 'distance'
--   - is_weighted = true                → 'weight'
--   - everything else                   → 'reps'
--
-- All new columns are nullable; no data is destroyed. The migration is
-- idempotent at the column level (`ADD COLUMN IF NOT EXISTS`) so re-running
-- on an already-migrated DB is a no-op.

ALTER TABLE movements
  ADD COLUMN IF NOT EXISTS metric_type TEXT NOT NULL DEFAULT 'reps';

COMMENT ON COLUMN movements.metric_type IS
  'How this movement is measured: ''reps'' | ''weight'' | ''calories'' | ''distance''. Drives which gender-split metric inputs the workout builder exposes.';

UPDATE movements
SET metric_type = CASE
  WHEN category = 'monostructural'
    AND canonical_name ~* '(row|ski|bike|echo)' THEN 'calories'
  WHEN category = 'monostructural'
    AND canonical_name ~* 'run' THEN 'distance'
  WHEN is_weighted = true THEN 'weight'
  ELSE 'reps'
END
WHERE metric_type = 'reps';
-- The WHERE clause means re-running the migration won't clobber any
-- user-overridden metric_type values (if a user later edits a movement's
-- metric_type to something non-default, that edit is preserved).

ALTER TABLE workout_movements
  ADD COLUMN IF NOT EXISTS prescribed_calories_male INTEGER,
  ADD COLUMN IF NOT EXISTS prescribed_calories_female INTEGER,
  ADD COLUMN IF NOT EXISTS prescribed_distance_male INTEGER,
  ADD COLUMN IF NOT EXISTS prescribed_distance_female INTEGER;

COMMENT ON COLUMN workout_movements.prescribed_calories_male IS
  'Rx calories for male athletes on a calorie-based movement (e.g. Row, Ski, Bike).';
COMMENT ON COLUMN workout_movements.prescribed_calories_female IS
  'Rx calories for female athletes on a calorie-based movement.';
COMMENT ON COLUMN workout_movements.prescribed_distance_male IS
  'Rx distance in meters for male athletes on a distance-based movement (e.g. Run).';
COMMENT ON COLUMN workout_movements.prescribed_distance_female IS
  'Rx distance in meters for female athletes on a distance-based movement.';
