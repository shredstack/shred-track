-- Partner / team workout flag. Workout-level rather than per-part — a
-- partner workout's structure is described in the workout-level
-- description ("one works while the other rests", "split reps however you
-- want"). For v1 this is informational only; the score is still logged
-- per-user. Mirrored on benchmark_workouts so partner Hero benchmarks
-- (e.g. The Seven, DT) inherit the flag when used as a template.

ALTER TABLE workouts
  ADD COLUMN IF NOT EXISTS is_partner BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS partner_count INTEGER;

COMMENT ON COLUMN workouts.is_partner IS
  'True when the workout is programmed for partners/teams. The description is expected to explain how work splits.';
COMMENT ON COLUMN workouts.partner_count IS
  'Optional team size (2 for partner, 3+ for team). Null when is_partner is false.';

ALTER TABLE benchmark_workouts
  ADD COLUMN IF NOT EXISTS is_partner BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS partner_count INTEGER;
