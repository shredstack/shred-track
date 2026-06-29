-- ============================================================================
-- Widen the part-level score_type override to support EMOM-specific modes.
--
-- Previously: score_type IN ('reps', 'load') (or NULL = derive from
-- workout_type). EMOM parts can now also score by:
--   - 'rounds' — rounds completed (structured "X rounds + Y reps")
--   - 'note'   — free-text result (explicit, instead of the implicit default)
--
-- Existing rows are unaffected (NULL / 'reps' / 'load' all still valid).
-- The three tables mirror the original constraint added in
-- 20260601195620_add_athlete_weight_source_and_part_score_type.sql.
-- ============================================================================

alter table workout_parts
  drop constraint if exists workout_parts_score_type_check;
alter table workout_parts
  add constraint workout_parts_score_type_check
    check (score_type is null or score_type in ('reps', 'load', 'rounds', 'note'));

alter table crossfit_workout_parts
  drop constraint if exists crossfit_workout_parts_score_type_check;
alter table crossfit_workout_parts
  add constraint crossfit_workout_parts_score_type_check
    check (score_type is null or score_type in ('reps', 'load', 'rounds', 'note'));

alter table benchmark_workout_parts
  drop constraint if exists benchmark_workout_parts_score_type_check;
alter table benchmark_workout_parts
  add constraint benchmark_workout_parts_score_type_check
    check (score_type is null or score_type in ('reps', 'load', 'rounds', 'note'));
