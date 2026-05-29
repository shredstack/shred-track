-- SUPERSEDED — this backfill now runs automatically as migration
-- supabase/migrations/20260528100001_backfill_section_benchmark_workout_id.sql.
--
-- Originally a Supabase SQL editor snippet because the unified-schema seed
-- (src/db/seeds/migrate_to_unified_crossfit.ts) depends on it: the seed
-- reads workout_sections.benchmark_workout_id to link sections to existing
-- benchmark templates instead of duplicating. Promoted to a migration so
-- the ordering is enforced by CI rather than human memory.
--
-- The migration contains only the UPDATE. The diagnostic SELECT below is
-- kept here for ad-hoc verification — safe to re-run anytime.

with candidates as (
  select
    ws.id as section_id,
    ws.title,
    bw.id as benchmark_id,
    bw.name as benchmark_name
  from workout_sections ws
  join benchmark_workouts bw
    on lower(trim(bw.name)) = lower(trim(ws.title))
  where ws.title is not null
    and trim(ws.title) <> ''
),
unique_matches as (
  select section_id, benchmark_id
  from candidates
  group by section_id, benchmark_id
  having (
    select count(*) from candidates c2 where c2.section_id = candidates.section_id
  ) = 1
)
select
  (select count(*) from unique_matches) as unique_title_matches,
  (select count(distinct section_id) from candidates) - (select count(*) from unique_matches)
    as ambiguous_skipped,
  (select count(*) from workout_sections where benchmark_workout_id is not null)
    as currently_linked;
