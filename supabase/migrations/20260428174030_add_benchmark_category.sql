-- Add a category column to benchmark_workouts so the app can group system
-- benchmarks (Girls, Heroes, CF Open, Weightlifting, Gym Benchmarks) and
-- filter them in the UI. Custom user benchmarks may leave this NULL.

ALTER TABLE benchmark_workouts
  ADD COLUMN category TEXT;

ALTER TABLE benchmark_workouts
  ADD CONSTRAINT benchmark_workouts_category_check
  CHECK (
    category IS NULL
    OR category IN ('girls', 'heroes', 'open', 'weightlifting', 'gym_benchmark')
  );

CREATE INDEX IF NOT EXISTS benchmark_workouts_category_idx
  ON benchmark_workouts (category);

-- Backfill known system benchmarks. The seed runner re-asserts these on every
-- deploy, but backfilling here means the column is already populated for any
-- environment that had benchmarks seeded before this migration ran.
UPDATE benchmark_workouts SET category = 'girls'
  WHERE is_system = true AND name IN (
    'Fran', 'Grace', 'Isabel', 'Helen', 'Diane', 'Elizabeth',
    'Annie', 'Karen', 'Jackie', 'Nancy', 'Kelly',
    'Cindy', 'Mary', 'Chelsea'
  );

UPDATE benchmark_workouts SET category = 'heroes'
  WHERE is_system = true AND name IN (
    'Murph', 'Half Murph', 'DT', 'Nate', 'JT',
    'Kalsu', 'Holleyman', 'Chad'
  );

UPDATE benchmark_workouts SET category = 'gym_benchmark'
  WHERE is_system = true AND name IN (
    'Fight Gone Bad', 'Filthy Fifty', 'The Chief'
  );

UPDATE benchmark_workouts SET category = 'weightlifting'
  WHERE is_system = true AND name IN (
    'Back Squat 1RM', 'Back Squat 5RM', 'Deadlift 1RM',
    'Front Squat 1RM', 'Overhead Squat 1RM',
    'Clean and Jerk 1RM', 'Snatch 1RM',
    'Bench Press 1RM', 'Shoulder Press 1RM'
  );

UPDATE benchmark_workouts SET category = 'open'
  WHERE is_system = true AND name = '14.4';
