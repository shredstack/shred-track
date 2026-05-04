-- Mirror the workout_movements column set onto benchmark_workout_movements
-- so multi-part benchmarks like Drew (mixed metric types: runs between rep
-- blocks, height-bearing box jumps, etc.) round-trip from benchmark seed →
-- benchmark form → linked workout without lossy intermediate shapes.
--
-- Additive only. Existing rows stay null on the new columns; the legacy
-- benchmark form path that only wrote weight/reps/rxStandard keeps working.

ALTER TABLE benchmark_workout_movements
  ADD COLUMN IF NOT EXISTS prescribed_calories_male TEXT,
  ADD COLUMN IF NOT EXISTS prescribed_calories_female TEXT,
  ADD COLUMN IF NOT EXISTS prescribed_distance_male TEXT,
  ADD COLUMN IF NOT EXISTS prescribed_distance_female TEXT,
  ADD COLUMN IF NOT EXISTS prescribed_duration_seconds_male INTEGER,
  ADD COLUMN IF NOT EXISTS prescribed_duration_seconds_female INTEGER,
  ADD COLUMN IF NOT EXISTS prescribed_height_inches NUMERIC,
  ADD COLUMN IF NOT EXISTS prescribed_height_inches_male NUMERIC,
  ADD COLUMN IF NOT EXISTS prescribed_height_inches_female NUMERIC,
  ADD COLUMN IF NOT EXISTS prescribed_weight_male_bw_multiplier NUMERIC,
  ADD COLUMN IF NOT EXISTS prescribed_weight_female_bw_multiplier NUMERIC,
  ADD COLUMN IF NOT EXISTS tempo TEXT,
  ADD COLUMN IF NOT EXISTS is_side_cadence BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rep_scheme_parsed JSONB,
  ADD COLUMN IF NOT EXISTS equipment_count INTEGER;
