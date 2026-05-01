-- ============================================
-- PushPress Parity — richer Rx specification
-- ============================================
--
-- Adds the structured columns needed to capture every workout shape the
-- Smart Builder couldn't previously express:
--
--   * duration prescriptions per gender on a movement (":30 L-sit",
--     "rest 2:00", "15 burpees in :40")
--   * tempo prescriptions ("10 BS @ 30X1") that combine reps + tempo string
--   * % bodyweight Rx loads ("deadlift @ 1.5x BW")
--   * deficit / box height per movement
--   * interval + rest cadence on workout_parts (Gripper Ripper-style:
--     8 rounds of 1:00 work / 3:00 rest), driving the new "intervals"
--     workout_type
--   * weighted-vest requirement on workouts and benchmark_workouts
--   * canonical user bodyweight (lb) so BW-multiplier prescriptions resolve
--   * actual duration / actual height per score_movement_detail and
--     wore_vest / vest_weight_lb on the score itself
--
-- All new columns are nullable; legacy rows are unaffected. Coexistence
-- rules (e.g. weight vs. BW multiplier mutual exclusion) are enforced by
-- the API + builder, not by CHECK constraints — the constraints would
-- over-constrain edge cases the spec accepts.

ALTER TABLE workout_movements
  ADD COLUMN IF NOT EXISTS prescribed_duration_seconds_male INTEGER,
  ADD COLUMN IF NOT EXISTS prescribed_duration_seconds_female INTEGER,
  ADD COLUMN IF NOT EXISTS prescribed_height_inches NUMERIC,
  ADD COLUMN IF NOT EXISTS prescribed_weight_male_bw_multiplier NUMERIC,
  ADD COLUMN IF NOT EXISTS prescribed_weight_female_bw_multiplier NUMERIC,
  ADD COLUMN IF NOT EXISTS tempo TEXT;

COMMENT ON COLUMN workout_movements.prescribed_duration_seconds_male IS
  'Rx duration in seconds for male athletes (":30 L-sit", "1:00 work", EMOM caps).';
COMMENT ON COLUMN workout_movements.prescribed_duration_seconds_female IS
  'Rx duration in seconds for female athletes.';
COMMENT ON COLUMN workout_movements.prescribed_height_inches IS
  'Per-instance height (deficit pushup, box jump, step-up) overriding any default. Inches.';
COMMENT ON COLUMN workout_movements.prescribed_weight_male_bw_multiplier IS
  'Rx weight as a multiple of bodyweight for male athletes (e.g. 1.5 = 1.5×BW).';
COMMENT ON COLUMN workout_movements.prescribed_weight_female_bw_multiplier IS
  'Rx weight as a multiple of bodyweight for female athletes.';
COMMENT ON COLUMN workout_movements.tempo IS
  'Free-text tempo prescription, e.g. "30X1" or "21X2". Not used for scoring.';

ALTER TABLE workout_parts
  ADD COLUMN IF NOT EXISTS interval_work_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS interval_rest_seconds INTEGER;

COMMENT ON COLUMN workout_parts.interval_work_seconds IS
  'Per-round work cap on the new "intervals" workout type (e.g. 60 for 1:00 work).';
COMMENT ON COLUMN workout_parts.interval_rest_seconds IS
  'Per-round rest after work on the new "intervals" workout type (e.g. 180 for 3:00 rest).';

ALTER TABLE workouts
  ADD COLUMN IF NOT EXISTS requires_vest BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vest_weight_male_lb NUMERIC,
  ADD COLUMN IF NOT EXISTS vest_weight_female_lb NUMERIC;

COMMENT ON COLUMN workouts.requires_vest IS
  'When true, workout calls for a weighted vest. Score logging adds a "wore vest" toggle.';

ALTER TABLE benchmark_workouts
  ADD COLUMN IF NOT EXISTS requires_vest BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vest_weight_male_lb NUMERIC,
  ADD COLUMN IF NOT EXISTS vest_weight_female_lb NUMERIC;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS body_weight_lb NUMERIC;

COMMENT ON COLUMN users.body_weight_lb IS
  'Canonical bodyweight in pounds. Used to resolve BW-multiplier Rx prescriptions.';

ALTER TABLE score_movement_details
  ADD COLUMN IF NOT EXISTS actual_duration_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS actual_height_inches NUMERIC;

COMMENT ON COLUMN score_movement_details.actual_duration_seconds IS
  'Actual duration the athlete held / sustained the movement. Used for "duration" metric movements.';
COMMENT ON COLUMN score_movement_details.actual_height_inches IS
  'Actual height (deficit, box) the athlete used. Defaults to the prescribed value at log time.';

ALTER TABLE scores
  ADD COLUMN IF NOT EXISTS wore_vest BOOLEAN,
  ADD COLUMN IF NOT EXISTS vest_weight_lb NUMERIC;

COMMENT ON COLUMN scores.wore_vest IS
  'True if the athlete wore the vest. Only meaningful when workouts.requires_vest is true.';
COMMENT ON COLUMN scores.vest_weight_lb IS
  'Vest weight the athlete actually wore (lb). Lets us record "wore 14 instead of 20" cases.';

-- Backfill metric_type for hold-style movements that historically defaulted
-- to "reps". The seed will keep these in sync going forward; the WHERE
-- clause keeps user-overridden metric_types intact.
UPDATE movements
SET metric_type = 'duration'
WHERE canonical_name IN ('L-Sit', 'Plank', 'Hollow Hold', 'Wall Sit', 'Dead Hang', 'Handstand Hold')
  AND metric_type = 'reps';
