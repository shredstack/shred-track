-- Movement-settings refactor (Phase 2 of CrossFit Smart Builder).
--
-- Today the builder's per-movement input rendering is hardcoded by
-- metric_type ("weight" → lb pair, "calories" → cal pair, etc.) plus a
-- handful of regex-based helpers (height-bearing names, Rest detection).
-- That makes adding a custom movement that needs a height + weight + tempo
-- a code change.
--
-- This migration moves that knowledge onto the `movements` table itself:
--
--   - supported_metric_types  All metric types the movement can be scored
--                             in. The user picks one per workout instance
--                             via workout_movements.metric_type.
--   - rx_fields               Which Rx inputs the builder surfaces.
--                             Subset of: weight, weight_bw, height,
--                             calories, distance, duration, tempo.
--   - rx_defaults             Per-field defaults (gendered where it
--                             matters). JSONB so we can evolve the shape
--                             without another migration.
--
-- The legacy single-value `metric_type` column stays — it's used as the
-- read-fallback for un-backfilled movements and as the per-instance
-- choice on workout_movements.
--
-- Rollback: setting `rx_fields = '{}'` for a single movement reverts that
-- movement to the legacy hardcoded-branches behavior in MovementListBuilder.

ALTER TABLE movements
  ADD COLUMN IF NOT EXISTS supported_metric_types TEXT[] NOT NULL DEFAULT ARRAY['reps'],
  ADD COLUMN IF NOT EXISTS rx_fields TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS rx_defaults JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN movements.supported_metric_types IS
  'All metric types this movement can be scored in. Backfilled from movements.metric_type. The builder picks one per workout instance via workout_movements.metric_type.';
COMMENT ON COLUMN movements.rx_fields IS
  'Rx inputs the builder surfaces when adding the movement. Drives MovementListBuilder rendering. Subset of: weight, weight_bw, height, calories, distance, duration, tempo. Empty array falls back to legacy hardcoded-branch behavior (rollback insurance).';
COMMENT ON COLUMN movements.rx_defaults IS
  'Default values per rx_field. Examples: { "height_inches_male": 24, "height_inches_female": 20 } for Box Jump; { "weight_male": 95, "weight_female": 65 } for Thruster.';

-- ===========================================================================
-- Backfill: supported_metric_types
-- ===========================================================================
--
-- Default to a single-element array of the existing metric_type. A few
-- movements support multiple metrics (e.g. Thruster can be scored for time
-- = reps OR for_load = weight; Row can be calories or distance).

UPDATE movements
SET supported_metric_types = ARRAY[metric_type]
WHERE supported_metric_types = ARRAY['reps']::TEXT[]
  AND metric_type != 'reps';

-- Weighted lifts: support both reps (workouts where you score by time/round)
-- AND weight (for_load workouts where you find a 1RM / heavy single).
UPDATE movements
SET supported_metric_types = ARRAY['reps', 'weight']
WHERE created_by IS NULL
  AND metric_type = 'weight';

-- Cardio machines: calories OR distance (Erg can be scored either way).
UPDATE movements
SET supported_metric_types = ARRAY['calories', 'distance']
WHERE created_by IS NULL
  AND canonical_name IN ('Row', 'SkiErg', 'Bike (Assault)', 'Bike (Echo)');

-- Run: distance OR duration (timed runs are common — 30 min run, etc.).
UPDATE movements
SET supported_metric_types = ARRAY['distance', 'duration']
WHERE created_by IS NULL
  AND canonical_name = 'Run';

-- ===========================================================================
-- Backfill: rx_fields + rx_defaults
-- ===========================================================================

-- Weighted movements → weight Rx field. Defaults filled in below per movement.
UPDATE movements
SET rx_fields = ARRAY['weight']
WHERE created_by IS NULL
  AND is_weighted = true;

-- Duration-only movements → duration Rx field, EXCEPT Rest. Rest stays at
-- rx_fields = [] so MovementListBuilder's legacy single-input branch (the
-- non-gendered "Rest duration" input) keeps applying — gender-split rest
-- is theatre. Detected at render time via
-- `rxFields.length === 0 && supportedMetricTypes.includes('duration')`.
UPDATE movements
SET rx_fields = ARRAY['duration']
WHERE created_by IS NULL
  AND metric_type = 'duration'
  AND canonical_name != 'Rest';

-- Calorie-typed cardio → calories Rx field.
UPDATE movements
SET rx_fields = ARRAY['calories']
WHERE created_by IS NULL
  AND canonical_name IN ('Row', 'SkiErg', 'Bike (Assault)', 'Bike (Echo)');

-- Run → distance Rx field.
UPDATE movements
SET rx_fields = ARRAY['distance']
WHERE created_by IS NULL
  AND canonical_name = 'Run';

-- ---------------------------------------------------------------------------
-- Height-bearing movements: bodyweight box jumps + step-ups + deficit work.
-- ---------------------------------------------------------------------------

-- Box jumps & step-ups: gendered 24/20 default.
UPDATE movements
SET rx_fields = ARRAY['height'],
    rx_defaults = jsonb_build_object('height_inches_male', 24, 'height_inches_female', 20)
WHERE created_by IS NULL
  AND canonical_name IN (
    'Box Jump',
    'Box Step-Up',
    'Burpee Box Jump Over'
  );

-- Deficit pushup / HSPU: gender-agnostic 4" default.
UPDATE movements
SET rx_fields = ARRAY['height'],
    rx_defaults = jsonb_build_object('height_inches_male', 4, 'height_inches_female', 4)
WHERE created_by IS NULL
  AND canonical_name IN (
    'Deficit Push-Up',
    'Deficit Handstand Push-Up'
  );

-- Dumbbell Box Step-Up — both weight and height matter.
UPDATE movements
SET rx_fields = ARRAY['weight', 'height'],
    rx_defaults = jsonb_build_object(
      'weight_male', 50,
      'weight_female', 35,
      'height_inches_male', 24,
      'height_inches_female', 20
    )
WHERE created_by IS NULL
  AND canonical_name = 'Dumbbell Box Step-Up';

-- ---------------------------------------------------------------------------
-- Per-movement weight defaults. These mirror the existing
-- common_rx_weight_male / common_rx_weight_female pair where set, but the
-- JSONB shape is what the builder reads going forward.
-- ---------------------------------------------------------------------------

-- 95/65 lb barbell movements (push press / jerk / shoulder press / OHS-ish).
UPDATE movements
SET rx_defaults = jsonb_build_object('weight_male', 95, 'weight_female', 65)
WHERE created_by IS NULL
  AND canonical_name IN (
    'Thruster',
    'Push Press',
    'Push Jerk',
    'Shoulder Press',
    'Overhead Press'
  );

-- 135/95 lb barbell movements (the classic Olympic-lift Rx pair).
UPDATE movements
SET rx_defaults = jsonb_build_object('weight_male', 135, 'weight_female', 95)
WHERE created_by IS NULL
  AND canonical_name IN (
    'Clean',
    'Power Clean',
    'Squat Clean',
    'Hang Clean',
    'Hang Power Clean',
    'Snatch',
    'Power Snatch',
    'Squat Snatch',
    'Hang Snatch',
    'Hang Power Snatch',
    'Clean and Jerk',
    'Split Jerk',
    'Front Squat',
    'Back Squat',
    'Bench Press',
    'Overhead Squat',
    'Sumo Deadlift High Pull'
  );

-- Deadlift Rx: 225/155.
UPDATE movements
SET rx_defaults = jsonb_build_object('weight_male', 225, 'weight_female', 155)
WHERE created_by IS NULL
  AND canonical_name = 'Deadlift';

-- Wall Ball: 20/14 lb.
UPDATE movements
SET rx_defaults = jsonb_build_object('weight_male', 20, 'weight_female', 14)
WHERE created_by IS NULL
  AND canonical_name = 'Wall Ball';

-- Kettlebell: 53/35 lb (24/16 kg).
UPDATE movements
SET rx_defaults = jsonb_build_object('weight_male', 53, 'weight_female', 35)
WHERE created_by IS NULL
  AND canonical_name IN (
    'Kettlebell Swing',
    'Goblet Squat',
    'Kettlebell Clean',
    'Kettlebell Snatch',
    'Kettlebell Turkish Get-Up'
  );

-- Dumbbell pairs: 50/35 lb is standard for most "DB X" movements.
UPDATE movements
SET rx_defaults = jsonb_build_object('weight_male', 50, 'weight_female', 35)
WHERE created_by IS NULL
  AND canonical_name IN (
    'DB Snatch',
    'DB Power Snatch',
    'DB Clean',
    'DB Power Clean',
    'DB Clean and Jerk',
    'DB Hang Power Clean',
    'DB Thruster',
    'DB Deadlift',
    'DB Row',
    'DB Push Press',
    'DB Push Jerk',
    'DB Shoulder Press',
    'DB Bench Press',
    'DB Overhead Press',
    'Devil Press',
    'Dumbbell Snatch',
    'Dumbbell Clean',
    'Dumbbell Thruster',
    'Dumbbell Hang Clean and Jerk',
    'Dumbbell Lunge',
    'Dumbbell Shoulder to Overhead',
    'Man Maker',
    'Turkish Get-Up'
  );

-- Farmers Carry: 70/53 lb (heavy carry but lighter than a barbell).
UPDATE movements
SET rx_defaults = jsonb_build_object('weight_male', 70, 'weight_female', 53)
WHERE created_by IS NULL
  AND canonical_name = 'Farmers Carry';
