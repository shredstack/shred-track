-- ============================================================================
-- Builder expressiveness: partner work modes, inter-part rest, three-state
-- vest, per-athlete scoring, trailing-rest suppression.
--
-- All new columns are nullable / default-false so existing rows render
-- identically. `requires_vest boolean` is hard-replaced by `vest_requirement`
-- enum text — the value migration runs in-place via the backfill statement.
--
-- Per-part columns added to all three part tables:
--   - partner_work_mode: 'any' | 'alternating' | 'single_at_a_time' | 'synchro'.
--     Null = no explicit mode (legacy / non-partner). Read at score-entry time
--     to decide whether to surface per-athlete inputs (single_at_a_time).
--   - rest_after_seconds: integer > 0. Rest period that follows this part
--     before the next part starts (renders as "Rest X:XX" pill). Null = no
--     rest displayed.
--   - suppress_trailing_rest: boolean default false. For `intervals` parts,
--     omits the rest after the final round (so a "2 rounds × 1:00 work / 2:00
--     rest, alternating athletes" reads as Athlete A 1:00 → Rest 2:00 →
--     Athlete B 1:00, with no trailing rest).
--
-- Workout-level columns: vest_requirement enum
--   - 'none' | 'optional' | 'required'. Backfilled from the existing
--     requires_vest boolean (true→'required', false→'none'). The
--     boolean column is then dropped — there are no external consumers.
--
-- Per-score column on scores:
--   - per_athlete_results jsonb. Array of {athleteLabel, value} when a part
--     is logged in single_at_a_time mode. Null otherwise.
-- ============================================================================

begin;

-- ---- Per-part columns (×3 part tables) -------------------------------------

alter table workout_parts
  add column if not exists partner_work_mode text
    check (
      partner_work_mode is null
      or partner_work_mode in ('any', 'alternating', 'single_at_a_time', 'synchro')
    ),
  add column if not exists rest_after_seconds integer
    check (rest_after_seconds is null or rest_after_seconds > 0),
  add column if not exists suppress_trailing_rest boolean not null default false;

alter table crossfit_workout_parts
  add column if not exists partner_work_mode text
    check (
      partner_work_mode is null
      or partner_work_mode in ('any', 'alternating', 'single_at_a_time', 'synchro')
    ),
  add column if not exists rest_after_seconds integer
    check (rest_after_seconds is null or rest_after_seconds > 0),
  add column if not exists suppress_trailing_rest boolean not null default false;

alter table benchmark_workout_parts
  add column if not exists partner_work_mode text
    check (
      partner_work_mode is null
      or partner_work_mode in ('any', 'alternating', 'single_at_a_time', 'synchro')
    ),
  add column if not exists rest_after_seconds integer
    check (rest_after_seconds is null or rest_after_seconds > 0),
  add column if not exists suppress_trailing_rest boolean not null default false;

-- ---- Three-state vest on all three workout-level tables --------------------

alter table workouts
  add column if not exists vest_requirement text
    check (
      vest_requirement is null
      or vest_requirement in ('none', 'optional', 'required')
    );

update workouts
set vest_requirement = case when requires_vest then 'required' else 'none' end
where vest_requirement is null;

alter table workouts
  alter column vest_requirement set not null,
  alter column vest_requirement set default 'none';

alter table workouts drop column if exists requires_vest;

alter table benchmark_workouts
  add column if not exists vest_requirement text
    check (
      vest_requirement is null
      or vest_requirement in ('none', 'optional', 'required')
    );

update benchmark_workouts
set vest_requirement = case when requires_vest then 'required' else 'none' end
where vest_requirement is null;

alter table benchmark_workouts
  alter column vest_requirement set not null,
  alter column vest_requirement set default 'none';

alter table benchmark_workouts drop column if exists requires_vest;

alter table crossfit_workouts
  add column if not exists vest_requirement text
    check (
      vest_requirement is null
      or vest_requirement in ('none', 'optional', 'required')
    );

update crossfit_workouts
set vest_requirement = case when requires_vest then 'required' else 'none' end
where vest_requirement is null;

alter table crossfit_workouts
  alter column vest_requirement set not null,
  alter column vest_requirement set default 'none';

alter table crossfit_workouts drop column if exists requires_vest;

-- ---- Per-athlete results on scores -----------------------------------------

alter table scores
  add column if not exists per_athlete_results jsonb;

commit;
