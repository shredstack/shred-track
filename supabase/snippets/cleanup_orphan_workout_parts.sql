-- Clean up orphaned workout_parts left behind by the pre-fix DELETE handler
-- in /api/gym/[id]/programming/sections.
--
-- Context: until this fix landed, deleting a single programming section
-- *detached* its parts (set workout_section_id = NULL) instead of deleting
-- them. The admin UI hid them, but the athlete-facing programmed day view
-- renders any orphan part under a title-less "Other" card with no score
-- logging or leaderboard. Members saw zombie WODs.
--
-- Heuristic: only delete orphan parts on workouts that have at least one
-- section. Pre-PR1 gym workouts legitimately have parts with
-- workout_section_id = NULL because sections didn't exist yet, and those
-- workouts have zero sections — we don't touch them.
--
-- Cascade: deleting workout_parts rows cascades via ON DELETE CASCADE FKs
-- to workout_blocks, workout_movements, scores, and notifications. The
-- diagnostic below counts the scores that will be removed — review before
-- committing.
--
-- Safety:
--   * Scoped to workouts that have ≥1 section (skips legacy/pre-PR1 data).
--   * Idempotent: a second run finds nothing.
--   * Wrapped in a transaction so you can rollback after the verification.
--
-- Run from the Supabase SQL editor (or `psql -f`).

begin;

-- Diagnostic 1: how many orphan parts and how many athlete scores will
-- disappear? If scores_to_cascade > 0, look at the per-row preview below
-- before committing — those scores will be permanently gone.
with orphans as (
  select wp.id as part_id, wp.workout_id
  from workout_parts wp
  where wp.workout_section_id is null
    and exists (
      select 1 from workout_sections ws where ws.workout_id = wp.workout_id
    )
)
select
  (select count(*) from orphans) as orphan_parts,
  (select count(distinct workout_id) from orphans) as affected_workouts,
  (
    select count(*)
    from scores s
    where s.workout_part_id in (select part_id from orphans)
  ) as scores_to_cascade;

-- Diagnostic 2: preview of what gets deleted. One row per orphan part with
-- the workout's date, community, part label, and any score count. Spot-
-- check before committing.
with orphans as (
  select wp.id as part_id, wp.workout_id, wp.label, wp.order_index, wp.workout_type
  from workout_parts wp
  where wp.workout_section_id is null
    and exists (
      select 1 from workout_sections ws where ws.workout_id = wp.workout_id
    )
)
select
  w.workout_date,
  w.community_id,
  o.part_id,
  o.order_index,
  o.label,
  o.workout_type,
  (select count(*) from scores s where s.workout_part_id = o.part_id) as score_count
from orphans o
join workouts w on w.id = o.workout_id
order by w.workout_date desc, w.community_id, o.order_index;

-- Perform the cleanup. Cascading FKs handle workout_blocks,
-- workout_movements, scores, and notifications.
with orphans as (
  select wp.id
  from workout_parts wp
  where wp.workout_section_id is null
    and exists (
      select 1 from workout_sections ws where ws.workout_id = wp.workout_id
    )
)
delete from workout_parts
where id in (select id from orphans);

-- Verification: should return 0.
select count(*) as remaining_orphans
from workout_parts wp
where wp.workout_section_id is null
  and exists (
    select 1 from workout_sections ws where ws.workout_id = wp.workout_id
  );

-- If anything looks off, run `rollback;` instead of `commit;`.
commit;
