-- Backfill workout_sections.benchmark_workout_id for sections that came
-- from the Benchmark tab in the programming admin section editor.
--
-- This MUST run before the migrate_to_unified_crossfit seed: that seed reads
-- workout_sections.benchmark_workout_id to decide whether a section maps to
-- an existing benchmark template (link) or needs a brand-new template
-- (duplicate). Sections programmed before 20260528100000 added the column
-- have it NULL, so without this backfill every pre-existing gym "Fran"
-- migrates as a fresh duplicate template instead of linking to the canonical
-- Fran benchmark.
--
-- Heuristic: when the section's title exactly matches a benchmark's name
-- (case-insensitive, trimmed), link them. The Benchmark tab writes
-- `title = benchmark.name` verbatim, so this is the same identity check the
-- UI uses. Sections an admin renamed (e.g. "Fran (heavy)") won't match —
-- those need a manual fix or a Smart Builder re-save.
--
-- Idempotent: only updates rows where benchmark_workout_id IS NULL, so a
-- second run is a no-op. Ambiguous titles that match >1 benchmark are
-- skipped via the per-section count filter.

with candidates as (
  select
    ws.id as section_id,
    bw.id as benchmark_id
  from workout_sections ws
  join benchmark_workouts bw
    on lower(trim(bw.name)) = lower(trim(ws.title))
  where ws.benchmark_workout_id is null
    and ws.title is not null
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
update workout_sections ws
set
  benchmark_workout_id = um.benchmark_id,
  updated_at = now()
from unique_matches um
where ws.id = um.section_id
  and ws.benchmark_workout_id is null;
