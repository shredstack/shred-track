-- Backfill workout_sections.benchmark_workout_id for sections that came
-- from the Benchmark tab in the programming admin section editor.
--
-- Context: until 20260528100000, picking a benchmark from the section
-- editor's Benchmark tab dropped the benchmark id and only stored the
-- benchmark's parts/title/notes. So gym-programmed Frans never linked back
-- to the Fran benchmark row, and athletes' scores on those sections didn't
-- appear in benchmark history / stats / insights trends.
--
-- Heuristic: when the section's title exactly matches a benchmark's name
-- (case-insensitive, trimmed), link them. The Benchmark tab writes
-- `title = benchmark.name` verbatim, so this is the same identity check
-- the UI uses. Sections an admin renamed (e.g. "Fran (heavy)") won't
-- match — those need a manual fix or a Smart Builder re-save.
--
-- Safety:
--   * Read-only on benchmark_workouts.
--   * Only updates rows where benchmark_workout_id IS NULL — never
--     overwrites a manually-set link.
--   * Skips ambiguous titles that match >1 benchmark (the LEFT JOIN +
--     COUNT filter below).
--   * Idempotent: running it twice does nothing the second time.
--
-- Run this from the Supabase SQL editor (or `psql -f`) after applying the
-- migration that adds the column.

begin;

-- Diagnostic: how many sections will be backfilled?
with candidates as (
  select
    ws.id as section_id,
    ws.title,
    bw.id as benchmark_id,
    bw.name as benchmark_name
  from workout_sections ws
  join benchmark_workouts bw
    on lower(trim(bw.name)) = lower(trim(ws.title))
  where ws.benchmark_workout_id is null
    and ws.title is not null
    and trim(ws.title) <> ''
),
-- Drop ambiguous titles (would match multiple benchmarks).
unique_matches as (
  select section_id, benchmark_id
  from candidates
  group by section_id, benchmark_id
  having (
    select count(*) from candidates c2 where c2.section_id = candidates.section_id
  ) = 1
)
select
  (select count(*) from unique_matches) as sections_to_backfill,
  (select count(distinct section_id) from candidates) - (select count(*) from unique_matches)
    as sections_skipped_ambiguous;

-- Perform the backfill.
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

-- Verification: list every backfilled section with the benchmark it now
-- points at. Spot-check a few before committing.
select
  ws.id as section_id,
  ws.title as section_title,
  bw.name as benchmark_name,
  bw.category as benchmark_category,
  w.workout_date,
  w.community_id
from workout_sections ws
join benchmark_workouts bw on bw.id = ws.benchmark_workout_id
join workouts w on w.id = ws.workout_id
where ws.updated_at >= now() - interval '1 minute'
order by w.workout_date desc, ws.title;

-- If the verification list looks wrong, run `rollback;` instead of `commit;`.
commit;
