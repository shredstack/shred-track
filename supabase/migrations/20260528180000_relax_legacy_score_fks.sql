-- Relax legacy NOT NULLs + add unified dedup constraint on scores.
--
-- Context: the write cutover (commit #5 of the unified crossfit workout
-- template refactor) stops populating scores.workout_id and
-- scores.workout_part_id for new score logs — those columns reference the
-- legacy `workouts` / `workout_parts` tables that are about to be dropped
-- in a follow-up migration. To let new inserts elide the legacy columns
-- safely, drop the NOT NULL on workout_id.
--
-- Dedup: today the (workout_part_id, user_id) unique index prevents an
-- athlete from logging two scores against the same part. With workout_part_id
-- now potentially NULL on new scores, the index stops covering new rows;
-- add the equivalent partial unique index on the unified-schema FK pair.
--
-- Once the drop migration retires the legacy columns, the partial index
-- becomes the full uniqueness constraint.

-- 1. Allow workout_id to be NULL on rows written under the unified schema.
alter table scores
  alter column workout_id drop not null;

-- 2. Dedup on the new FK. Mirrors the legacy `scores_part_user_unique`
--    constraint that fires on (workout_part_id, user_id).
create unique index if not exists scores_crossfit_part_user_unique
  on scores (crossfit_workout_part_id, user_id)
  where crossfit_workout_part_id is not null;
