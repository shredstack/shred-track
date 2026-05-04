-- Widen prescribed_calories_male/female and prescribed_distance_male/female
-- from INTEGER to TEXT so they can carry rep-scheme expressions like
-- "75-50-25" alongside scalar values. Backfill is automatic via
-- numeric::text. The same rep-scheme parser used for prescribed_reps
-- handles parsing on read.

ALTER TABLE workout_movements
  ALTER COLUMN prescribed_calories_male TYPE TEXT
    USING prescribed_calories_male::text,
  ALTER COLUMN prescribed_calories_female TYPE TEXT
    USING prescribed_calories_female::text,
  ALTER COLUMN prescribed_distance_male TYPE TEXT
    USING prescribed_distance_male::text,
  ALTER COLUMN prescribed_distance_female TYPE TEXT
    USING prescribed_distance_female::text;

COMMENT ON COLUMN workout_movements.prescribed_calories_male IS
  'Male calorie prescription. Free-text so rep-scheme expressions like "75-50-25" are valid alongside scalar values.';
COMMENT ON COLUMN workout_movements.prescribed_calories_female IS
  'Female calorie prescription. Free-text so rep-scheme expressions like "60-40-20" are valid alongside scalar values.';
COMMENT ON COLUMN workout_movements.prescribed_distance_male IS
  'Male distance prescription (meters). Free-text so rep-scheme expressions are valid alongside scalar values.';
COMMENT ON COLUMN workout_movements.prescribed_distance_female IS
  'Female distance prescription (meters). Free-text so rep-scheme expressions are valid alongside scalar values.';
