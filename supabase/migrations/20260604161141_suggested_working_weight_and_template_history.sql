-- ============================================================================
-- Suggested working weight + template history.
--
-- See claude_code_instructions/crossfit_improvements/
--     suggested_working_weight_and_template_history_spec.md
--
-- Adds:
--   1. movements.rx_stimulus_class   — admin-curated stimulus class the
--      catalog Rx weight is calibrated for. Used as a baseline scale.
--   2. stimulus_profiles              — (stimulus_class, movement_category)
--      → %1RM band lookup table. Admin-editable.
--   3. athlete_movement_strength      — per-(user, movement) cache of the
--      athlete's best logged or estimated 1RM. Materialized on score save
--      and by a nightly sweep.
--   4. score_movement_details.suggested_weight_lb_low / _high / _confidence
--      / _method — snapshot of the suggestion that was on screen when the
--      score was logged. Display/analytics only; never overrides actual
--      logged weight.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. movements.rx_stimulus_class
-- ----------------------------------------------------------------------------
alter table movements
  add column if not exists rx_stimulus_class text
    check (
      rx_stimulus_class is null or rx_stimulus_class in (
        'short_intense',
        'moderate_metcon',
        'long_metcon',
        'strength_heavy',
        'strength_moderate',
        'oly_metcon'
      )
    );

-- ----------------------------------------------------------------------------
-- 2. stimulus_profiles — admin-editable %1RM bands per (class, category).
--    Seeded by src/db/seeds/stimulus_profiles.ts on every deploy.
-- ----------------------------------------------------------------------------
create table if not exists stimulus_profiles (
  stimulus_class text not null
    check (stimulus_class in (
      'strength_heavy',
      'strength_moderate',
      'short_intense',
      'moderate_metcon',
      'long_metcon',
      'oly_metcon'
    )),
  movement_category text not null,
  pct_1rm_low numeric(4, 3) not null
    check (pct_1rm_low > 0 and pct_1rm_low <= 1),
  pct_1rm_high numeric(4, 3) not null
    check (pct_1rm_high > 0 and pct_1rm_high <= 1),
  notes text,
  updated_at timestamptz not null default now(),
  primary key (stimulus_class, movement_category),
  constraint stimulus_profiles_band_ordered check (pct_1rm_low <= pct_1rm_high)
);

-- ----------------------------------------------------------------------------
-- 3. athlete_movement_strength — per-(user, movement) best-known 1RM cache.
-- ----------------------------------------------------------------------------
create table if not exists athlete_movement_strength (
  user_id uuid not null references users(id) on delete cascade,
  movement_id uuid not null references movements(id) on delete cascade,
  estimated_1rm_lb numeric(6, 2) not null,
  source text not null
    check (source in (
      'logged_1rm',
      'epley_from_set',
      'brzycki_from_set',
      'gym_default'
    )),
  source_score_id uuid references scores(id) on delete set null,
  source_set_weight_lb numeric(6, 2),
  source_set_reps integer,
  sample_size integer not null default 1,
  last_observed_at timestamptz not null,
  computed_at timestamptz not null default now(),
  primary key (user_id, movement_id)
);

create index if not exists idx_ams_user
  on athlete_movement_strength (user_id);

create index if not exists idx_ams_movement
  on athlete_movement_strength (movement_id);

-- ----------------------------------------------------------------------------
-- 4. score_movement_details suggestion snapshot.
--    Display/analytics only — never used to override the athlete's actual
--    logged weight. Nullable so the column is cheap to add against existing
--    rows.
-- ----------------------------------------------------------------------------
alter table score_movement_details
  add column if not exists suggested_weight_lb_low numeric(6, 2);

alter table score_movement_details
  add column if not exists suggested_weight_lb_high numeric(6, 2);

alter table score_movement_details
  add column if not exists suggested_weight_confidence text
    check (
      suggested_weight_confidence is null
      or suggested_weight_confidence in ('high', 'medium', 'low')
    );

alter table score_movement_details
  add column if not exists suggested_weight_method text
    check (
      suggested_weight_method is null
      or suggested_weight_method in (
        'logged_1rm',
        'estimated_1rm',
        'similar_template_history',
        'direct_template_history',
        'rx_fallback',
        'unavailable'
      )
    );

-- ----------------------------------------------------------------------------
-- 5. RLS — defense-in-depth. All app writes go through the postgres service
--    role (bypasses RLS); these policies guard any access via the Supabase
--    JS client. Mirrors the pattern used by user_movement_paces +
--    community_calorie_preferences.
-- ----------------------------------------------------------------------------

-- stimulus_profiles is admin-curated global reference data. The admin
-- endpoint (super-admin gated in the route handler) is the only writer, and
-- it runs server-side via the service role. No policies = no Supabase-JS
-- access; the catalog is only readable through the API.
alter table stimulus_profiles enable row level security;

-- athlete_movement_strength is per-user. Reads through the Supabase JS
-- client are scoped to the calling user. Writes only happen server-side via
-- the strength updater (service role).
alter table athlete_movement_strength enable row level security;

create policy "athlete_movement_strength_select_own"
  on athlete_movement_strength for select using (auth.uid() = user_id);
