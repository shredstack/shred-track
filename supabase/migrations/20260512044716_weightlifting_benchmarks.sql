-- Weightlifting benchmarks: anchor system rep-max benchmarks to a movement.
--
-- See claude_code_instructions/weightlifting_benchmarks_spec.md.
-- The old hand-seeded one-per-rep-max rows ("Back Squat 1RM", "Back Squat 5RM",
-- "Deadlift 1RM", ...) are dropped and replaced by auto-generated rows keyed
-- by movement_id (one per 1RM-applicable movement). The "1RM / 2RM / 3RM /
-- 5RM" views are derived at query time from the athlete's for_load history.
--
-- Existing weightlifting benchmark rows are confirmed unused in production
-- (per product owner), so we delete-and-rebuild instead of trying to merge.

-- ---------------------------------------------------------------------------
-- Column + unique index
-- ---------------------------------------------------------------------------

ALTER TABLE benchmark_workouts
  ADD COLUMN weightlifting_movement_id uuid
    REFERENCES movements(id) ON DELETE CASCADE;

-- At most one weightlifting benchmark per movement. Partial so non-weightlifting
-- benchmarks (Girls, Heroes, …) don't have to occupy slots in the index.
CREATE UNIQUE INDEX benchmark_workouts_weightlifting_movement_unique
  ON benchmark_workouts (weightlifting_movement_id)
  WHERE weightlifting_movement_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Reset old hand-seeded weightlifting benchmarks
-- ---------------------------------------------------------------------------
--
-- Detach any workouts that happen to point at the old rows. workouts.benchmark_workout_id
-- is ON DELETE SET NULL, so this is defensive — but the explicit UPDATE keeps
-- the cleanup self-documenting in the migration log.

UPDATE workouts
   SET benchmark_workout_id = NULL
 WHERE benchmark_workout_id IN (
   SELECT id FROM benchmark_workouts WHERE category = 'weightlifting'
 );

DELETE FROM benchmark_workouts
 WHERE category = 'weightlifting';
