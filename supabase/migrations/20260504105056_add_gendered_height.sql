-- Gendered Rx height for movements where the M/F prescription differs
-- (e.g. box jump 24"/20"). Backfill both gendered columns from the
-- existing single column so older rows don't lose data. The legacy
-- prescribed_height_inches column is retained as a deprecated read
-- fallback for one release.

ALTER TABLE workout_movements
  ADD COLUMN IF NOT EXISTS prescribed_height_inches_male NUMERIC,
  ADD COLUMN IF NOT EXISTS prescribed_height_inches_female NUMERIC;

UPDATE workout_movements
SET prescribed_height_inches_male = prescribed_height_inches,
    prescribed_height_inches_female = prescribed_height_inches
WHERE prescribed_height_inches IS NOT NULL
  AND prescribed_height_inches_male IS NULL
  AND prescribed_height_inches_female IS NULL;

COMMENT ON COLUMN workout_movements.prescribed_height_inches_male IS
  'Male Rx height (inches). Used for box jump / step-up / deficit pushup. Falls back to prescribed_height_inches when null.';
COMMENT ON COLUMN workout_movements.prescribed_height_inches_female IS
  'Female Rx height (inches). Used for box jump / step-up / deficit pushup. Falls back to prescribed_height_inches when null.';
