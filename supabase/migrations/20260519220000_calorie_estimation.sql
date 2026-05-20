-- ============================================================
-- Calorie estimation feature — schema additions
-- ============================================================
-- Adds:
--   * MET fields + pace flags on `movements`
--   * Template-level estimate columns on `workouts` + `workout_parts`
--   * Session/personalized estimate columns on `scores`
--   * `user_movement_paces` (per-athlete observed rep cadence)
--   * `community_calorie_preferences` (gym-level EPOC defaults)
--   * Per-user calorie preferences on `users`
-- See `claude_code_instructions/crossfit_improvements/crossfit_calorie_estimation_spec.md`.

-- ---------- Movements: MET + pace fields ----------

alter table movements
  add column if not exists met_value numeric(4,1)
    check (met_value is null or (met_value > 0 and met_value < 25)),
  add column if not exists met_compendium_code text,
  add column if not exists met_is_estimated boolean not null default false,
  add column if not exists met_source text default '2024 Adult Compendium',
  add column if not exists met_notes text,
  add column if not exists rep_seconds_default numeric(4,2),
  add column if not exists is_paced_run boolean not null default false,
  add column if not exists is_paced_erg text
    check (is_paced_erg is null or is_paced_erg in ('row', 'ski')),
  add column if not exists met_updated_at timestamptz;

-- ---------- Workouts: template-level estimate (75 kg reference) ----------

alter table workouts
  add column if not exists estimated_kcal_low integer,
  add column if not exists estimated_kcal_high integer,
  add column if not exists estimated_kcal_method text,
  add column if not exists estimated_kcal_confidence text,
  add column if not exists estimated_kcal_computed_at timestamptz;

-- ---------- Workout parts: per-part estimates ----------

alter table workout_parts
  add column if not exists estimated_kcal_low integer,
  add column if not exists estimated_kcal_high integer,
  add column if not exists estimated_kcal_confidence text;

-- ---------- Scores: personalized + Apple Health bookkeeping ----------

alter table scores
  add column if not exists started_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists duration_seconds integer,
  add column if not exists bodyweight_lb_at_score numeric(5,2),
  add column if not exists estimated_kcal integer,
  add column if not exists estimated_kcal_active integer,
  add column if not exists estimated_kcal_with_epoc integer,
  add column if not exists estimated_kcal_active_with_epoc integer,
  add column if not exists estimated_kcal_method text,
  add column if not exists estimated_kcal_confidence text,
  add column if not exists estimated_kcal_source text not null default 'model',
  add column if not exists apple_health_workout_uuid uuid;

-- ---------- Per-athlete observed rep cadence ----------

create table if not exists user_movement_paces (
  user_id uuid not null references users(id) on delete cascade,
  movement_id uuid not null references movements(id) on delete cascade,
  rep_seconds_observed numeric(4,2) not null,
  sample_size integer not null,
  last_computed_at timestamptz not null default now(),
  primary key (user_id, movement_id)
);

create index if not exists user_movement_paces_movement_idx
  on user_movement_paces(movement_id);

-- ---------- Per-gym EPOC preferences ----------

create table if not exists community_calorie_preferences (
  community_id uuid primary key references communities(id) on delete cascade,
  epoc_default_enabled boolean not null default true,
  epoc_multiplier numeric(3,2) not null default 1.10
    check (epoc_multiplier >= 1.0 and epoc_multiplier <= 1.20),
  updated_at timestamptz not null default now()
);

-- ---------- Per-user calorie preferences ----------

alter table users
  add column if not exists epoc_enabled boolean,
  add column if not exists push_to_apple_health boolean not null default true;

-- ---------- RLS ----------
-- App writes go through the postgres service role (bypasses RLS), so these
-- policies are defense-in-depth for any access via the Supabase JS client.

alter table user_movement_paces enable row level security;

create policy "user_movement_paces_select_own"
  on user_movement_paces for select using (auth.uid() = user_id);
create policy "user_movement_paces_insert_own"
  on user_movement_paces for insert with check (auth.uid() = user_id);
create policy "user_movement_paces_update_own"
  on user_movement_paces for update using (auth.uid() = user_id);
create policy "user_movement_paces_delete_own"
  on user_movement_paces for delete using (auth.uid() = user_id);

alter table community_calorie_preferences enable row level security;

create policy "community_calorie_preferences_select_members"
  on community_calorie_preferences for select using (
    community_id in (
      select community_id from community_memberships where user_id = auth.uid()
    )
  );
create policy "community_calorie_preferences_write_admin"
  on community_calorie_preferences for all using (
    community_id in (
      select community_id from community_memberships
      where user_id = auth.uid() and is_admin = true
    )
  ) with check (
    community_id in (
      select community_id from community_memberships
      where user_id = auth.uid() and is_admin = true
    )
  );
