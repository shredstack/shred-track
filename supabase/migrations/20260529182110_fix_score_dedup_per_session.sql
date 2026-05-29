-- Fix score dedup constraint after the unified-schema cutover.
--
-- Context: migration 20260528180000 added
--   scores_crossfit_part_user_unique (crossfit_workout_part_id, user_id)
-- as the unified-schema mirror of the legacy
--   scores_part_user_unique (workout_part_id, user_id).
--
-- That mirror is wrong. Pre-cutover, `workout_parts.id` was per-`workouts`
-- row, and `workouts` was per-session — so (workout_part_id, user_id)
-- effectively meant "one score per user per session-part". Post-cutover,
-- `crossfit_workout_parts.id` is per-TEMPLATE: the same part is reused
-- across every session that schedules the template. Dedup'ing on
-- (crossfit_workout_part_id, user_id) blocks the same athlete from ever
-- logging the same workout template more than once.
--
-- Correct dedup is per session: one score per
-- (workout_session_id, crossfit_workout_part_id, user_id). That permits
-- repeated scoring of the same template across days while still
-- preventing a duplicate insert inside one session.
--
-- No data fixup is needed: the existing index was strictly tighter than
-- the new one, so every surviving row already satisfies the new key.

drop index if exists scores_crossfit_part_user_unique;

create unique index if not exists scores_session_part_user_unique
  on scores (workout_session_id, crossfit_workout_part_id, user_id)
  where workout_session_id is not null and crossfit_workout_part_id is not null;
