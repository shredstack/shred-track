-- ============================================
-- "Max reps" movements + per-round actual reps
-- ============================================
--
-- Some workouts (intervals, AMRAPs, Kalsu, "max thrusters in a 1:00 window")
-- score by counting how many reps of one specific movement the athlete
-- accumulated. The rest of the movements are pace/setup work.
--
-- Two changes:
--
-- 1) `workout_movements.is_max_reps` (and same on benchmark_workout_movements)
--    declares the movement as the score-bearing movement. When true the
--    builder hides the reps integer (the count is what the athlete logs)
--    and the score-entry surfaces per-round inputs.
--
-- 2) `score_movement_details.actual_reps_per_round` captures per-round rep
--    counts for max-reps movements. The sum drives the part-level total.
--    Stored as INTEGER[] so we get array semantics (length === rounds,
--    individual round access for analytics).

ALTER TABLE workout_movements
  ADD COLUMN IF NOT EXISTS is_max_reps BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN workout_movements.is_max_reps IS
  'When true, this movement is scored by max-reps-per-round (e.g. "max clean and jerks in a 1:00 window"). The reps integer is meaningless — the score-entry surfaces per-round inputs instead.';

ALTER TABLE benchmark_workout_movements
  ADD COLUMN IF NOT EXISTS is_max_reps BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE score_movement_details
  ADD COLUMN IF NOT EXISTS actual_reps_per_round INTEGER[];

COMMENT ON COLUMN score_movement_details.actual_reps_per_round IS
  'Per-round rep counts for max-reps movements. Length matches the part rounds; individual entries support per-round analytics (consistency, fade across rounds).';
