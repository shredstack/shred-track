-- ============================================================================
-- Athlete-picked weight capture.
--
-- Mirrors capture_duration_per_round (migration 20260528225457):
--   - Per-movement weight_source flag across all three movement tables.
--   - Per-round weight array on score_movement_details (lb, numeric).
--   - Part-level score_type override on workout_parts + crossfit_workout_parts
--     + benchmark_workout_parts.
--
-- weight_source = 'prescribed' (default) | 'athlete'.
-- score_type    = NULL (default, derived from workout_type) | 'reps' | 'load'.
-- ============================================================================

-- Movement-instance flag. NOT NULL with default keeps backfill trivial.
alter table workout_movements
  add column if not exists weight_source text not null default 'prescribed'
    check (weight_source in ('prescribed', 'athlete'));

alter table benchmark_workout_movements
  add column if not exists weight_source text not null default 'prescribed'
    check (weight_source in ('prescribed', 'athlete'));

alter table crossfit_workout_movements
  add column if not exists weight_source text not null default 'prescribed'
    check (weight_source in ('prescribed', 'athlete'));

-- Part-level scoring override. Nullable so existing rows keep the legacy
-- "derive from workout_type" behavior.
alter table workout_parts
  add column if not exists score_type text
    check (score_type is null or score_type in ('reps', 'load'));

alter table crossfit_workout_parts
  add column if not exists score_type text
    check (score_type is null or score_type in ('reps', 'load'));

alter table benchmark_workout_parts
  add column if not exists score_type text
    check (score_type is null or score_type in ('reps', 'load'));

-- Per-round captured weight (lb). Mirrors actual_reps_per_round and
-- actual_duration_seconds_per_round. Length should equal part.rounds;
-- empty slots round-trip as 0 (DNF for that round, like the precedent).
-- numeric (not integer) preserves half-pound entries from kg->lb conversion.
alter table score_movement_details
  add column if not exists actual_weight_lbs_per_round numeric[];
