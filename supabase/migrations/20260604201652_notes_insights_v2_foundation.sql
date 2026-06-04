-- ============================================================================
-- Notes Insights v2 — Foundation (PR 1)
--
-- See claude_code_instructions/crossfit_improvements/notes_insights_v2_spec.md
-- (§3, §4) for the rationale.
--
-- Adds:
--   1. score_notes_extractions.performance_signals — new JSONB column for
--      quantitative phrases the LLM extracts (e.g. "30 unbroken DUs in 1.5
--      min"). Defaults to '[]' so existing rows remain valid until the
--      back-catalog re-extracts on the next NOTES_MODEL_VERSION bump.
--   2. score_movement_signals — denormalized per-(score, movement) row of
--      the same signals, kept in lockstep with the JSONB by the extraction
--      worker. Powers the workout-detail prep card (PR 2) without walking
--      every JSONB row.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. performance_signals column on score_notes_extractions
-- ----------------------------------------------------------------------------
alter table score_notes_extractions
  add column if not exists performance_signals jsonb not null default '[]'::jsonb;

-- ----------------------------------------------------------------------------
-- 2. score_movement_signals — denormalized lookup table.
--    `movement_name` is a free-text canonical-ish string emitted by the LLM
--    (not an FK to movements.id) so the extraction worker doesn't need to
--    resolve catalog drift at write time. PR 2's prep card resolves to a
--    movements row at read time via case-insensitive canonical_name match.
-- ----------------------------------------------------------------------------
create table if not exists score_movement_signals (
  id              uuid primary key default gen_random_uuid(),
  score_id        uuid not null references scores(id) on delete cascade,
  user_id         uuid not null references users(id) on delete cascade,
  movement_name   text not null,
  metric          text not null
    check (metric in (
      'unbroken_reps',
      'reps_in_window',
      'set_split',
      'pace',
      'load_for_reps'
    )),
  value           numeric not null,
  unit            text not null,
  -- `window` is a reserved word in PostgreSQL — keep it namespaced so the
  -- column is unquoted in every query. The JSON/TS shape still uses
  -- `window` (the LLM-facing key).
  metric_window   text,
  qualitative     text
    check (qualitative is null or qualitative in ('better', 'same', 'worse')),
  phrase          text not null,
  workout_date    date not null,
  extracted_at    timestamptz not null default now()
);

-- Prep-card lookup is "give me this user's signals for movement X in the
-- last 90 days" — index on (user, lower(movement), date desc) covers it.
create index if not exists score_movement_signals_user_movement_date_idx
  on score_movement_signals (user_id, lower(movement_name), workout_date desc);

-- The worker deletes by score_id on every re-extraction; covering index
-- keeps that cheap as the table grows.
create index if not exists score_movement_signals_score_id_idx
  on score_movement_signals (score_id);

-- ----------------------------------------------------------------------------
-- 3. RLS — mirrors score_notes_extractions. All app writes go through the
--    service role (bypasses RLS); these policies guard any Supabase-JS read.
-- ----------------------------------------------------------------------------
alter table score_movement_signals enable row level security;

create policy "Users read own movement signals"
  on score_movement_signals
  for select
  using (user_id = auth.uid());

create policy "Service role manages movement signals"
  on score_movement_signals
  for all using (true) with check (true);
