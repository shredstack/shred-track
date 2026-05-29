-- Adds per-round time capture for movements like "Run 400m × 3, as fast as
-- possible". Mirrors `is_max_reps` / `actual_reps_per_round`: the movement-
-- level boolean flags the movement as the time-bearing one, and the score-
-- detail array holds one duration per round.
--
-- Three movement tables get the flag because the unified schema cutover is
-- still in progress:
--   • workout_movements        — legacy user-workout movements
--   • benchmark_workout_movements — benchmark templates
--   • crossfit_workout_movements — unified-schema canonical templates
--
-- `score_movement_details.actual_duration_seconds_per_round` is the per-round
-- capture, mirroring `actual_reps_per_round`. Length should match the part's
-- `rounds`.

alter table workout_movements
  add column if not exists capture_duration_per_round boolean not null default false;

alter table benchmark_workout_movements
  add column if not exists capture_duration_per_round boolean not null default false;

alter table crossfit_workout_movements
  add column if not exists capture_duration_per_round boolean not null default false;

alter table score_movement_details
  add column if not exists actual_duration_seconds_per_round integer[];
