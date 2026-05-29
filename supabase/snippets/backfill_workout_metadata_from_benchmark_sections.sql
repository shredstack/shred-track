-- Backfill workout-level metadata (description, partner, vest) from the
-- benchmark a programmed section is linked to.
--
-- Context: until the Benchmark-tab consistency fix, picking a benchmark from
-- the programming-admin section editor only wrote section-level fields. The
-- parent workouts row never got the benchmark's description, partner flag,
-- or vest prescription — so athlete-facing programmed days were missing the
-- italic blurb, "Partner workout" chip, and vest chip that the CrossFit-tab
-- benchmark add wrote out via POST /api/workouts.
--
-- This snippet brings pre-existing programmed benchmark sections in line
-- with the new write path. For every workout that has a section pointing at
-- a benchmark, it copies the benchmark's metadata onto the parent workout,
-- but only into fields that are still at their default. We never overwrite
-- a coach-customized value.
--
-- Dependencies / ordering:
--   1. Apply migration `20260528100000_add_benchmark_workout_id_to_workout_sections.sql`
--      first (adds the workout_sections.benchmark_workout_id column).
--   2. Run snippet `backfill_section_benchmark_workout_id.sql` next so
--      pre-existing benchmark sections get their FK populated by title
--      match. Without it, this snippet has nothing to walk through.
--   3. Run THIS snippet last.
--
-- Heuristic for "still at default":
--   * description / partner_count / vest_weight_male_lb / vest_weight_female_lb
--     — only fill when the column IS NULL on workouts.
--   * is_partner / requires_vest — only flip to true when the column is
--     currently false AND the benchmark wants true. (These are NOT NULL
--     with a default of false, so NULL isn't a "blank" signal.)
--
-- Tie-breaker: a workout could in principle have multiple benchmark-linked
-- sections (e.g. two benchmarks in one day). The athlete-side renderer
-- attaches workout-level chips to the lowest-position benchmark section, so
-- we pick the same one here for consistency.
--
-- Also clears `section.notes` when it exactly matches the linked benchmark's
-- description (case-insensitive, trimmed). Older versions of the section
-- write path stashed the description there; once `workouts.description` is
-- backfilled below, leaving it on the section would render the blurb twice.
--
-- Safety:
--   * Wrapped in a single transaction — diagnostics first, then updates,
--     then verification. If the verification list looks wrong, run
--     `rollback;` instead of `commit;`.
--   * Idempotent: re-running it does nothing the second time because every
--     update predicate gates on "is this still at default?".

begin;

-- ============================================================
-- Diagnostic: what's about to change?
-- ============================================================

with linked_sections as (
  select
    ws.workout_id,
    ws.id as section_id,
    ws.position,
    ws.benchmark_workout_id,
    ws.notes,
    bw.description as bm_description,
    bw.is_partner as bm_is_partner,
    bw.partner_count as bm_partner_count,
    bw.requires_vest as bm_requires_vest,
    bw.vest_weight_male_lb as bm_vest_weight_male_lb,
    bw.vest_weight_female_lb as bm_vest_weight_female_lb,
    row_number() over (
      partition by ws.workout_id
      order by ws.position, ws.id
    ) as rn
  from workout_sections ws
  join benchmark_workouts bw on bw.id = ws.benchmark_workout_id
  where ws.benchmark_workout_id is not null
),
owners as (
  select * from linked_sections where rn = 1
)
select
  count(*) filter (
    where w.description is null and o.bm_description is not null
  ) as descriptions_to_fill,
  count(*) filter (
    where w.is_partner = false and o.bm_is_partner = true
  ) as partner_flags_to_flip,
  count(*) filter (
    where w.partner_count is null and o.bm_partner_count is not null
  ) as partner_counts_to_fill,
  count(*) filter (
    where w.requires_vest = false and o.bm_requires_vest = true
  ) as vest_flags_to_flip,
  count(*) filter (
    where w.vest_weight_male_lb is null and o.bm_vest_weight_male_lb is not null
  ) as vest_male_to_fill,
  count(*) filter (
    where w.vest_weight_female_lb is null and o.bm_vest_weight_female_lb is not null
  ) as vest_female_to_fill,
  (select count(*) from workout_sections ws2
    join benchmark_workouts bw2 on bw2.id = ws2.benchmark_workout_id
    where ws2.notes is not null
      and bw2.description is not null
      and trim(lower(ws2.notes)) = trim(lower(bw2.description))
  ) as duplicate_notes_to_clear
from owners o
join workouts w on w.id = o.workout_id;

-- ============================================================
-- Update 1: copy benchmark metadata onto the parent workout.
-- ============================================================

with linked_sections as (
  select
    ws.workout_id,
    ws.id as section_id,
    ws.position,
    ws.benchmark_workout_id,
    bw.description as bm_description,
    bw.is_partner as bm_is_partner,
    bw.partner_count as bm_partner_count,
    bw.requires_vest as bm_requires_vest,
    bw.vest_weight_male_lb as bm_vest_weight_male_lb,
    bw.vest_weight_female_lb as bm_vest_weight_female_lb,
    row_number() over (
      partition by ws.workout_id
      order by ws.position, ws.id
    ) as rn
  from workout_sections ws
  join benchmark_workouts bw on bw.id = ws.benchmark_workout_id
  where ws.benchmark_workout_id is not null
),
owners as (
  select * from linked_sections where rn = 1
)
update workouts w
set
  description = coalesce(w.description, o.bm_description),
  is_partner = case
    when w.is_partner = false and o.bm_is_partner = true then true
    else w.is_partner
  end,
  partner_count = coalesce(w.partner_count, o.bm_partner_count),
  requires_vest = case
    when w.requires_vest = false and o.bm_requires_vest = true then true
    else w.requires_vest
  end,
  vest_weight_male_lb = coalesce(w.vest_weight_male_lb, o.bm_vest_weight_male_lb),
  vest_weight_female_lb = coalesce(w.vest_weight_female_lb, o.bm_vest_weight_female_lb),
  updated_at = now()
from owners o
where w.id = o.workout_id
  and (
    (w.description is null and o.bm_description is not null)
    or (w.is_partner = false and o.bm_is_partner = true)
    or (w.partner_count is null and o.bm_partner_count is not null)
    or (w.requires_vest = false and o.bm_requires_vest = true)
    or (w.vest_weight_male_lb is null and o.bm_vest_weight_male_lb is not null)
    or (w.vest_weight_female_lb is null and o.bm_vest_weight_female_lb is not null)
  );

-- ============================================================
-- Update 2: clear section.notes that duplicates the benchmark
-- description. With workouts.description now backfilled above,
-- leaving these in place would render the blurb twice (once in
-- the section header area, once in the "Coach notes" block).
-- ============================================================

update workout_sections ws
set
  notes = null,
  updated_at = now()
from benchmark_workouts bw
where ws.benchmark_workout_id = bw.id
  and ws.notes is not null
  and bw.description is not null
  and trim(lower(ws.notes)) = trim(lower(bw.description));

-- ============================================================
-- Verification: spot-check a few backfilled workouts. Each row
-- should show the benchmark's name plus the metadata that's now
-- on the parent workout.
-- ============================================================

select
  w.id as workout_id,
  w.workout_date,
  bw.name as benchmark_name,
  w.description is not null as has_description,
  w.is_partner,
  w.partner_count,
  w.requires_vest,
  w.vest_weight_male_lb,
  w.vest_weight_female_lb,
  w.community_id
from workouts w
join workout_sections ws on ws.workout_id = w.id
join benchmark_workouts bw on bw.id = ws.benchmark_workout_id
where w.updated_at >= now() - interval '1 minute'
order by w.workout_date desc
limit 50;

-- If the verification looks wrong, run `rollback;` instead of `commit;`.
commit;
