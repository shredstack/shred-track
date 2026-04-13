-- ============================================
-- Benchmark Workouts
-- ============================================

CREATE TABLE benchmark_workouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  workout_type TEXT NOT NULL,
  time_cap_seconds INTEGER,
  amrap_duration_seconds INTEGER,
  rep_scheme TEXT,
  created_by UUID REFERENCES users(id),
  community_id UUID REFERENCES communities(id),
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- System benchmarks are globally unique by name
CREATE UNIQUE INDEX benchmark_workouts_system_name
  ON benchmark_workouts (name) WHERE is_system = true;

-- User benchmarks are unique per user
CREATE UNIQUE INDEX benchmark_workouts_user_name
  ON benchmark_workouts (created_by, name) WHERE is_system = false AND community_id IS NULL;

-- Community benchmarks are unique per community
CREATE UNIQUE INDEX benchmark_workouts_community_name
  ON benchmark_workouts (community_id, name) WHERE community_id IS NOT NULL;

-- Lookup indexes
CREATE INDEX benchmark_workouts_created_by ON benchmark_workouts (created_by);
CREATE INDEX benchmark_workouts_community_id ON benchmark_workouts (community_id);

-- ============================================
-- Benchmark Workout Movements
-- ============================================

CREATE TABLE benchmark_workout_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  benchmark_workout_id UUID NOT NULL REFERENCES benchmark_workouts(id) ON DELETE CASCADE,
  movement_id UUID NOT NULL REFERENCES movements(id),
  order_index INTEGER NOT NULL,
  prescribed_reps TEXT,
  prescribed_weight_male NUMERIC,
  prescribed_weight_female NUMERIC,
  rx_standard TEXT,
  notes TEXT
);

CREATE INDEX benchmark_workout_movements_workout ON benchmark_workout_movements (benchmark_workout_id);

-- ============================================
-- Add benchmark_workout_id to workouts
-- ============================================

ALTER TABLE workouts
  ADD COLUMN benchmark_workout_id UUID REFERENCES benchmark_workouts(id) ON DELETE SET NULL;

-- ============================================
-- RLS Policies
-- ============================================

ALTER TABLE benchmark_workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE benchmark_workout_movements ENABLE ROW LEVEL SECURITY;

-- System benchmarks: readable by all authenticated users
CREATE POLICY "System benchmarks are readable by all"
  ON benchmark_workouts FOR SELECT
  USING (is_system = true);

-- User benchmarks: CRUD by owner
CREATE POLICY "Users can read their own benchmarks"
  ON benchmark_workouts FOR SELECT
  USING (auth.uid() = created_by);

CREATE POLICY "Users can create their own benchmarks"
  ON benchmark_workouts FOR INSERT
  WITH CHECK (auth.uid() = created_by AND is_system = false);

CREATE POLICY "Users can update their own benchmarks"
  ON benchmark_workouts FOR UPDATE
  USING (auth.uid() = created_by AND is_system = false);

CREATE POLICY "Users can delete their own benchmarks"
  ON benchmark_workouts FOR DELETE
  USING (auth.uid() = created_by AND is_system = false);

-- Community benchmarks: readable by community members
CREATE POLICY "Community members can read community benchmarks"
  ON benchmark_workouts FOR SELECT
  USING (
    community_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM community_memberships
      WHERE community_memberships.community_id = benchmark_workouts.community_id
        AND community_memberships.user_id = auth.uid()
    )
  );

-- Benchmark movements: readable when parent benchmark is readable
CREATE POLICY "Benchmark movements are readable with parent"
  ON benchmark_workout_movements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM benchmark_workouts
      WHERE benchmark_workouts.id = benchmark_workout_movements.benchmark_workout_id
    )
  );

CREATE POLICY "Benchmark movements insertable by benchmark owner"
  ON benchmark_workout_movements FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM benchmark_workouts
      WHERE benchmark_workouts.id = benchmark_workout_movements.benchmark_workout_id
        AND (benchmark_workouts.created_by = auth.uid() OR benchmark_workouts.is_system = true)
    )
  );

CREATE POLICY "Benchmark movements deletable by benchmark owner"
  ON benchmark_workout_movements FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM benchmark_workouts
      WHERE benchmark_workouts.id = benchmark_workout_movements.benchmark_workout_id
        AND benchmark_workouts.created_by = auth.uid()
    )
  );

-- ============================================
-- Seed Movements (idempotent — skips if already exist)
-- Required before benchmark seeding since benchmarks reference movements by canonical_name.
-- ============================================

INSERT INTO movements (canonical_name, category, is_weighted, is_1rm_applicable, common_rx_weight_male, common_rx_weight_female) VALUES
  -- Barbell
  ('Back Squat', 'barbell', true, true, NULL, NULL),
  ('Front Squat', 'barbell', true, true, NULL, NULL),
  ('Overhead Squat', 'barbell', true, true, NULL, NULL),
  ('Deadlift', 'barbell', true, true, NULL, NULL),
  ('Sumo Deadlift High Pull', 'barbell', true, false, 75, 55),
  ('Clean', 'barbell', true, true, NULL, NULL),
  ('Power Clean', 'barbell', true, true, 135, 95),
  ('Squat Clean', 'barbell', true, true, NULL, NULL),
  ('Hang Clean', 'barbell', true, true, NULL, NULL),
  ('Clean and Jerk', 'barbell', true, true, NULL, NULL),
  ('Snatch', 'barbell', true, true, 135, 95),
  ('Power Snatch', 'barbell', true, true, 135, 95),
  ('Squat Snatch', 'barbell', true, true, NULL, NULL),
  ('Hang Snatch', 'barbell', true, true, NULL, NULL),
  ('Thruster', 'barbell', true, false, 95, 65),
  ('Push Press', 'barbell', true, true, 135, 95),
  ('Push Jerk', 'barbell', true, true, NULL, NULL),
  ('Split Jerk', 'barbell', true, true, NULL, NULL),
  ('Shoulder Press', 'barbell', true, true, NULL, NULL),
  ('Bench Press', 'barbell', true, true, NULL, NULL),
  ('Overhead Press', 'barbell', true, true, NULL, NULL),
  ('Barbell Lunge', 'barbell', true, false, NULL, NULL),
  ('Barbell Row', 'barbell', true, true, NULL, NULL),
  ('Cluster', 'barbell', true, false, NULL, NULL),
  ('Hang Power Clean', 'barbell', true, true, NULL, NULL),
  ('Hang Power Snatch', 'barbell', true, true, NULL, NULL),
  -- Dumbbell
  ('Dumbbell Snatch', 'dumbbell', true, false, 50, 35),
  ('Dumbbell Clean', 'dumbbell', true, false, NULL, NULL),
  ('Dumbbell Thruster', 'dumbbell', true, false, 50, 35),
  ('Devil Press', 'dumbbell', true, false, 50, 35),
  ('Man Maker', 'dumbbell', true, false, 50, 35),
  ('Turkish Get-Up', 'dumbbell', true, false, NULL, NULL),
  ('Dumbbell Lunge', 'dumbbell', true, false, 50, 35),
  ('Dumbbell Box Step-Up', 'dumbbell', true, false, 50, 35),
  ('Dumbbell Shoulder to Overhead', 'dumbbell', true, false, NULL, NULL),
  ('Dumbbell Hang Clean and Jerk', 'dumbbell', true, false, NULL, NULL),
  -- Kettlebell
  ('Kettlebell Swing', 'kettlebell', true, false, 53, 35),
  ('Kettlebell Clean', 'kettlebell', true, false, NULL, NULL),
  ('Kettlebell Snatch', 'kettlebell', true, false, NULL, NULL),
  ('Goblet Squat', 'kettlebell', true, false, NULL, NULL),
  ('Kettlebell Turkish Get-Up', 'kettlebell', true, false, NULL, NULL),
  -- Gymnastics
  ('Pull-Up', 'gymnastics', false, false, NULL, NULL),
  ('Chest-to-Bar Pull-Up', 'gymnastics', false, false, NULL, NULL),
  ('Muscle-Up', 'gymnastics', false, false, NULL, NULL),
  ('Bar Muscle-Up', 'gymnastics', false, false, NULL, NULL),
  ('Ring Muscle-Up', 'gymnastics', false, false, NULL, NULL),
  ('Handstand Push-Up', 'gymnastics', false, false, NULL, NULL),
  ('Strict Handstand Push-Up', 'gymnastics', false, false, NULL, NULL),
  ('Handstand Walk', 'gymnastics', false, false, NULL, NULL),
  ('Toes-to-Bar', 'gymnastics', false, false, NULL, NULL),
  ('Knees-to-Elbow', 'gymnastics', false, false, NULL, NULL),
  ('Rope Climb', 'gymnastics', false, false, NULL, NULL),
  ('Ring Dip', 'gymnastics', false, false, NULL, NULL),
  ('Pistol Squat', 'gymnastics', false, false, NULL, NULL),
  ('L-Sit', 'gymnastics', false, false, NULL, NULL),
  ('Strict Pull-Up', 'gymnastics', false, false, NULL, NULL),
  ('Kipping Pull-Up', 'gymnastics', false, false, NULL, NULL),
  ('Ring Row', 'gymnastics', false, false, NULL, NULL),
  ('Legless Rope Climb', 'gymnastics', false, false, NULL, NULL),
  -- Bodyweight
  ('Push-Up', 'bodyweight', false, false, NULL, NULL),
  ('Air Squat', 'bodyweight', false, false, NULL, NULL),
  ('Burpee', 'bodyweight', false, false, NULL, NULL),
  ('Burpee Box Jump Over', 'bodyweight', false, false, NULL, NULL),
  ('Box Jump', 'bodyweight', false, false, NULL, NULL),
  ('Box Step-Up', 'bodyweight', false, false, NULL, NULL),
  ('Lunge', 'bodyweight', false, false, NULL, NULL),
  ('Walking Lunge', 'bodyweight', false, false, NULL, NULL),
  ('Sit-Up', 'bodyweight', false, false, NULL, NULL),
  ('GHD Sit-Up', 'bodyweight', false, false, NULL, NULL),
  ('Back Extension', 'bodyweight', false, false, NULL, NULL),
  ('Jumping Jack', 'bodyweight', false, false, NULL, NULL),
  ('Double-Under', 'bodyweight', false, false, NULL, NULL),
  ('Single-Under', 'bodyweight', false, false, NULL, NULL),
  ('Wall Ball', 'bodyweight', true, false, 20, 14),
  ('V-Up', 'bodyweight', false, false, NULL, NULL),
  -- Monostructural
  ('Run', 'monostructural', false, false, NULL, NULL),
  ('Row', 'monostructural', false, false, NULL, NULL),
  ('Bike (Assault)', 'monostructural', false, false, NULL, NULL),
  ('SkiErg', 'monostructural', false, false, NULL, NULL),
  ('Swim', 'monostructural', false, false, NULL, NULL),
  ('Bike (Echo)', 'monostructural', false, false, NULL, NULL),
  ('Sled Push', 'monostructural', true, false, NULL, NULL),
  ('Sled Pull', 'monostructural', true, false, NULL, NULL),
  ('Farmers Carry', 'monostructural', true, false, NULL, NULL),
  ('Sandbag Lunges', 'monostructural', true, false, NULL, NULL)
ON CONFLICT (canonical_name) DO NOTHING;

-- ============================================
-- Seed System Benchmark Workouts
-- ============================================
-- Uses a DO block so we can reference movement IDs by canonical_name.
-- Each benchmark is inserted only if it doesn't already exist (idempotent).

DO $$
DECLARE
  bw_id UUID;
BEGIN
  -- ==================== THE GIRLS ====================

  -- Fran
  INSERT INTO benchmark_workouts (name, description, workout_type, rep_scheme, is_system)
  VALUES ('Fran', 'One of the original CrossFit benchmark workouts. A short, intense couplet.', 'for_time', '21-15-9', true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO bw_id;
  IF bw_id IS NOT NULL THEN
    INSERT INTO benchmark_workout_movements (benchmark_workout_id, movement_id, order_index, prescribed_reps, prescribed_weight_male, prescribed_weight_female)
    VALUES
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Thruster'), 0, '21-15-9', 95, 65),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Pull-Up'), 1, '21-15-9', NULL, NULL);
  END IF;

  -- Grace
  INSERT INTO benchmark_workouts (name, description, workout_type, rep_scheme, is_system)
  VALUES ('Grace', '30 clean and jerks for time. A true test of barbell cycling speed.', 'for_time', '30 reps', true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO bw_id;
  IF bw_id IS NOT NULL THEN
    INSERT INTO benchmark_workout_movements (benchmark_workout_id, movement_id, order_index, prescribed_reps, prescribed_weight_male, prescribed_weight_female)
    VALUES (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Clean and Jerk'), 0, '30', 135, 95);
  END IF;

  -- Isabel
  INSERT INTO benchmark_workouts (name, description, workout_type, rep_scheme, is_system)
  VALUES ('Isabel', '30 snatches for time. Grace''s Olympic lifting counterpart.', 'for_time', '30 reps', true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO bw_id;
  IF bw_id IS NOT NULL THEN
    INSERT INTO benchmark_workout_movements (benchmark_workout_id, movement_id, order_index, prescribed_reps, prescribed_weight_male, prescribed_weight_female)
    VALUES (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Snatch'), 0, '30', 135, 95);
  END IF;

  -- Helen
  INSERT INTO benchmark_workouts (name, description, workout_type, rep_scheme, is_system)
  VALUES ('Helen', 'A classic triplet combining running, kettlebell swings, and pull-ups.', 'for_time', '3 rounds', true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO bw_id;
  IF bw_id IS NOT NULL THEN
    INSERT INTO benchmark_workout_movements (benchmark_workout_id, movement_id, order_index, prescribed_reps, prescribed_weight_male, prescribed_weight_female)
    VALUES
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Run'), 0, '400m', NULL, NULL),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Kettlebell Swing'), 1, '21', 53, 35),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Pull-Up'), 2, '12', NULL, NULL);
  END IF;

  -- Diane
  INSERT INTO benchmark_workouts (name, description, workout_type, rep_scheme, is_system)
  VALUES ('Diane', 'A fast couplet of deadlifts and handstand push-ups.', 'for_time', '21-15-9', true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO bw_id;
  IF bw_id IS NOT NULL THEN
    INSERT INTO benchmark_workout_movements (benchmark_workout_id, movement_id, order_index, prescribed_reps, prescribed_weight_male, prescribed_weight_female)
    VALUES
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Deadlift'), 0, '21-15-9', 225, 155),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Handstand Push-Up'), 1, '21-15-9', NULL, NULL);
  END IF;

  -- Elizabeth
  INSERT INTO benchmark_workouts (name, description, workout_type, rep_scheme, is_system)
  VALUES ('Elizabeth', 'A couplet of cleans and ring dips.', 'for_time', '21-15-9', true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO bw_id;
  IF bw_id IS NOT NULL THEN
    INSERT INTO benchmark_workout_movements (benchmark_workout_id, movement_id, order_index, prescribed_reps, prescribed_weight_male, prescribed_weight_female)
    VALUES
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Clean'), 0, '21-15-9', 135, 95),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Ring Dip'), 1, '21-15-9', NULL, NULL);
  END IF;

  -- Annie
  INSERT INTO benchmark_workouts (name, description, workout_type, rep_scheme, is_system)
  VALUES ('Annie', 'A descending couplet of double-unders and sit-ups.', 'for_time', '50-40-30-20-10', true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO bw_id;
  IF bw_id IS NOT NULL THEN
    INSERT INTO benchmark_workout_movements (benchmark_workout_id, movement_id, order_index, prescribed_reps)
    VALUES
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Double-Under'), 0, '50-40-30-20-10'),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Sit-Up'), 1, '50-40-30-20-10');
  END IF;

  -- Karen
  INSERT INTO benchmark_workouts (name, description, workout_type, rep_scheme, is_system)
  VALUES ('Karen', '150 wall balls for time. Simple but brutal.', 'for_time', '150 reps', true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO bw_id;
  IF bw_id IS NOT NULL THEN
    INSERT INTO benchmark_workout_movements (benchmark_workout_id, movement_id, order_index, prescribed_reps, prescribed_weight_male, prescribed_weight_female)
    VALUES (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Wall Ball'), 0, '150', 20, 14);
  END IF;

  -- Jackie
  INSERT INTO benchmark_workouts (name, description, workout_type, is_system)
  VALUES ('Jackie', 'A classic triplet: row, thrusters, pull-ups.', 'for_time', true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO bw_id;
  IF bw_id IS NOT NULL THEN
    INSERT INTO benchmark_workout_movements (benchmark_workout_id, movement_id, order_index, prescribed_reps, prescribed_weight_male, prescribed_weight_female)
    VALUES
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Row'), 0, '1000m', NULL, NULL),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Thruster'), 1, '50', 45, 35),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Pull-Up'), 2, '30', NULL, NULL);
  END IF;

  -- Nancy
  INSERT INTO benchmark_workouts (name, description, workout_type, rep_scheme, is_system)
  VALUES ('Nancy', '5 rounds of running and overhead squats.', 'for_time', '5 rounds', true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO bw_id;
  IF bw_id IS NOT NULL THEN
    INSERT INTO benchmark_workout_movements (benchmark_workout_id, movement_id, order_index, prescribed_reps, prescribed_weight_male, prescribed_weight_female)
    VALUES
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Run'), 0, '400m', NULL, NULL),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Overhead Squat'), 1, '15', 95, 65);
  END IF;

  -- Kelly
  INSERT INTO benchmark_workouts (name, description, workout_type, rep_scheme, is_system)
  VALUES ('Kelly', '5 rounds of running, box jumps, and wall balls.', 'for_time', '5 rounds', true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO bw_id;
  IF bw_id IS NOT NULL THEN
    INSERT INTO benchmark_workout_movements (benchmark_workout_id, movement_id, order_index, prescribed_reps, prescribed_weight_male, prescribed_weight_female, notes)
    VALUES
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Run'), 0, '400m', NULL, NULL, NULL),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Box Jump'), 1, '30', NULL, NULL, '24/20 inch box'),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Wall Ball'), 2, '30', 20, 14, NULL);
  END IF;

  -- Cindy
  INSERT INTO benchmark_workouts (name, description, workout_type, amrap_duration_seconds, is_system)
  VALUES ('Cindy', 'As many rounds as possible of the classic bodyweight triplet.', 'amrap', 1200, true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO bw_id;
  IF bw_id IS NOT NULL THEN
    INSERT INTO benchmark_workout_movements (benchmark_workout_id, movement_id, order_index, prescribed_reps)
    VALUES
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Pull-Up'), 0, '5'),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Push-Up'), 1, '10'),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Air Squat'), 2, '15');
  END IF;

  -- Mary
  INSERT INTO benchmark_workouts (name, description, workout_type, amrap_duration_seconds, is_system)
  VALUES ('Mary', 'AMRAP 20 of handstand push-ups, pistols, and pull-ups.', 'amrap', 1200, true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO bw_id;
  IF bw_id IS NOT NULL THEN
    INSERT INTO benchmark_workout_movements (benchmark_workout_id, movement_id, order_index, prescribed_reps)
    VALUES
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Handstand Push-Up'), 0, '5'),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Pistol Squat'), 1, '10'),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Pull-Up'), 2, '15');
  END IF;

  -- Chelsea
  INSERT INTO benchmark_workouts (name, description, workout_type, time_cap_seconds, is_system)
  VALUES ('Chelsea', 'EMOM 30 minutes: pull-ups, push-ups, and air squats every minute.', 'emom', 1800, true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO bw_id;
  IF bw_id IS NOT NULL THEN
    INSERT INTO benchmark_workout_movements (benchmark_workout_id, movement_id, order_index, prescribed_reps)
    VALUES
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Pull-Up'), 0, '5'),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Push-Up'), 1, '10'),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Air Squat'), 2, '15');
  END IF;

  -- ==================== HERO WODS ====================

  -- Murph
  INSERT INTO benchmark_workouts (name, description, workout_type, is_system)
  VALUES ('Murph', 'In honor of Navy Lt. Michael Murphy. Wear a 20/14 lb vest if possible.', 'for_time', true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO bw_id;
  IF bw_id IS NOT NULL THEN
    INSERT INTO benchmark_workout_movements (benchmark_workout_id, movement_id, order_index, prescribed_reps, notes)
    VALUES
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Run'), 0, '1 mile', NULL),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Pull-Up'), 1, '100', NULL),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Push-Up'), 2, '200', NULL),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Air Squat'), 3, '300', NULL),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Run'), 4, '1 mile', 'Finish with a 1-mile run');
  END IF;

  -- DT
  INSERT INTO benchmark_workouts (name, description, workout_type, rep_scheme, is_system)
  VALUES ('DT', 'In honor of USAF SSgt Timothy P. Davis. 5 rounds of barbell work.', 'for_time', '5 rounds', true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO bw_id;
  IF bw_id IS NOT NULL THEN
    INSERT INTO benchmark_workout_movements (benchmark_workout_id, movement_id, order_index, prescribed_reps, prescribed_weight_male, prescribed_weight_female)
    VALUES
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Deadlift'), 0, '12', 155, 105),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Hang Power Clean'), 1, '9', 155, 105),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Push Jerk'), 2, '6', 155, 105);
  END IF;

  -- Nate
  INSERT INTO benchmark_workouts (name, description, workout_type, amrap_duration_seconds, is_system)
  VALUES ('Nate', 'In honor of Chief Petty Officer Nate Hardy. AMRAP of gymnastics and KB work.', 'amrap', 1200, true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO bw_id;
  IF bw_id IS NOT NULL THEN
    INSERT INTO benchmark_workout_movements (benchmark_workout_id, movement_id, order_index, prescribed_reps, prescribed_weight_male, prescribed_weight_female)
    VALUES
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Muscle-Up'), 0, '2', NULL, NULL),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Handstand Push-Up'), 1, '4', NULL, NULL),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Kettlebell Swing'), 2, '8', 70, 53);
  END IF;

  -- JT
  INSERT INTO benchmark_workouts (name, description, workout_type, rep_scheme, is_system)
  VALUES ('JT', 'In honor of Petty Officer 1st Class Jeff Taylor. Gymnastics push triplet.', 'for_time', '21-15-9', true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO bw_id;
  IF bw_id IS NOT NULL THEN
    INSERT INTO benchmark_workout_movements (benchmark_workout_id, movement_id, order_index, prescribed_reps)
    VALUES
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Handstand Push-Up'), 0, '21-15-9'),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Ring Dip'), 1, '21-15-9'),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Push-Up'), 2, '21-15-9');
  END IF;

  -- ==================== COMMON GYM BENCHMARKS ====================

  -- Fight Gone Bad
  INSERT INTO benchmark_workouts (name, description, workout_type, rep_scheme, is_system)
  VALUES ('Fight Gone Bad', '3 rounds, 1 minute at each station, 1 minute rest between rounds. Score is total reps.', 'for_reps', '3 rounds', true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO bw_id;
  IF bw_id IS NOT NULL THEN
    INSERT INTO benchmark_workout_movements (benchmark_workout_id, movement_id, order_index, prescribed_reps, prescribed_weight_male, prescribed_weight_female, notes)
    VALUES
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Wall Ball'), 0, '1 min', 20, 14, NULL),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Sumo Deadlift High Pull'), 1, '1 min', 75, 55, NULL),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Box Jump'), 2, '1 min', NULL, NULL, '20 inch box'),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Push Press'), 3, '1 min', 75, 55, NULL),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Row'), 4, '1 min (calories)', NULL, NULL, NULL);
  END IF;

  -- Filthy Fifty
  INSERT INTO benchmark_workouts (name, description, workout_type, rep_scheme, is_system)
  VALUES ('Filthy Fifty', '50 reps of 10 movements for time. A long chipper.', 'for_time', '50 reps each', true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO bw_id;
  IF bw_id IS NOT NULL THEN
    INSERT INTO benchmark_workout_movements (benchmark_workout_id, movement_id, order_index, prescribed_reps, prescribed_weight_male, prescribed_weight_female, notes)
    VALUES
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Box Jump'), 0, '50', NULL, NULL, '24 inch box'),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Pull-Up'), 1, '50', NULL, NULL, 'Jumping pull-ups'),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Kettlebell Swing'), 2, '50', 35, 26, NULL),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Walking Lunge'), 3, '50', NULL, NULL, NULL),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Knees-to-Elbow'), 4, '50', NULL, NULL, NULL),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Push Press'), 5, '50', 45, 35, NULL),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Back Extension'), 6, '50', NULL, NULL, NULL),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Wall Ball'), 7, '50', 20, 14, NULL),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Burpee'), 8, '50', NULL, NULL, NULL),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Double-Under'), 9, '50', NULL, NULL, NULL);
  END IF;

  -- The Chief
  INSERT INTO benchmark_workouts (name, description, workout_type, amrap_duration_seconds, rep_scheme, is_system)
  VALUES ('The Chief', '5 cycles of 3-minute AMRAPs with 1 minute rest between cycles.', 'amrap', 900, '5 x 3-min AMRAPs', true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO bw_id;
  IF bw_id IS NOT NULL THEN
    INSERT INTO benchmark_workout_movements (benchmark_workout_id, movement_id, order_index, prescribed_reps, prescribed_weight_male, prescribed_weight_female)
    VALUES
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Power Clean'), 0, '3', 135, 95),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Push-Up'), 1, '6', NULL, NULL),
      (bw_id, (SELECT id FROM movements WHERE canonical_name = 'Air Squat'), 2, '9', NULL, NULL);
  END IF;

END $$;
