-- Initial schema migration for ShredTrack
-- Creates all application tables matching src/db/schema.ts

-- ============================================
-- Enable required extensions
-- ============================================
create extension if not exists "pgcrypto";

-- ============================================
-- Users & Auth
-- ============================================

create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text not null,
  gender text,
  unit_preference text not null default 'imperial',
  image text,
  email_verified timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  provider text not null,
  provider_account_id text not null,
  refresh_token text,
  access_token text,
  expires_at integer,
  token_type text,
  scope text,
  id_token text,
  session_state text
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  session_token text unique not null,
  user_id uuid not null references users(id) on delete cascade,
  expires timestamptz not null
);

create table verification_tokens (
  identifier text not null,
  token text not null,
  expires timestamptz not null
);

create unique index verification_tokens_identifier_token
  on verification_tokens (identifier, token);

-- ============================================
-- Communities
-- ============================================

create table communities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text unique not null,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table community_memberships (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references communities(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now()
);

create unique index community_memberships_unique
  on community_memberships (community_id, user_id);

-- ============================================
-- CrossFit: Movements
-- ============================================

create table movements (
  id uuid primary key default gen_random_uuid(),
  canonical_name text unique not null,
  category text not null,
  is_weighted boolean not null default false,
  is_1rm_applicable boolean not null default false,
  common_rx_weight_male numeric,
  common_rx_weight_female numeric,
  created_at timestamptz not null default now()
);

-- ============================================
-- CrossFit: Workouts
-- ============================================

create table workouts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references users(id),
  community_id uuid references communities(id),
  title text,
  description text,
  raw_text text,
  workout_type text not null,
  time_cap_seconds integer,
  amrap_duration_seconds integer,
  rep_scheme text,
  workout_date date not null,
  published boolean not null default false,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table workout_movements (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references workouts(id) on delete cascade,
  movement_id uuid not null references movements(id),
  order_index integer not null,
  prescribed_reps text,
  prescribed_weight_male numeric,
  prescribed_weight_female numeric,
  rx_standard text,
  notes text
);

-- ============================================
-- CrossFit: Scores
-- ============================================

create table scores (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references workouts(id) on delete cascade,
  user_id uuid not null references users(id),
  division text not null,
  time_seconds integer,
  rounds integer,
  remainder_reps integer,
  weight_lbs numeric,
  total_reps integer,
  score_text text,
  hit_time_cap boolean not null default false,
  notes text,
  rpe integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index scores_workout_user
  on scores (workout_id, user_id);

create table score_movement_details (
  id uuid primary key default gen_random_uuid(),
  score_id uuid not null references scores(id) on delete cascade,
  workout_movement_id uuid not null,
  was_rx boolean not null default true,
  actual_weight numeric,
  actual_reps text,
  modification text,
  substitution_movement_id uuid references movements(id),
  set_weights jsonb,
  notes text,
  constraint smd_workout_movement_id_fk
    foreign key (workout_movement_id) references workout_movements(id)
);

-- ============================================
-- HYROX: Profile & Assessments
-- ============================================

create table hyrox_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null references users(id),
  target_division text not null,
  next_race_date date,
  easy_pace_seconds_per_unit integer,
  moderate_pace_seconds_per_unit integer,
  fast_pace_seconds_per_unit integer,
  pace_unit text not null default 'mile',
  previous_race_count integer not null default 0,
  best_finish_time_seconds integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table hyrox_station_assessments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references hyrox_profiles(id) on delete cascade,
  station text not null,
  completion_confidence integer not null,
  current_time_seconds integer,
  goal_time_seconds integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index station_assessments_unique
  on hyrox_station_assessments (profile_id, station);

-- ============================================
-- HYROX: Training Plans
-- ============================================

create table hyrox_training_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  title text not null,
  total_weeks integer not null,
  start_date date not null,
  end_date date not null,
  plan_type text not null,
  status text not null default 'active',
  pace_scale_factor numeric not null,
  created_at timestamptz not null default now()
);

create table hyrox_plan_sessions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references hyrox_training_plans(id) on delete cascade,
  week integer not null,
  day_of_week integer not null,
  session_type text not null,
  title text not null,
  description text not null,
  target_pace text,
  duration_minutes integer,
  phase text not null,
  order_in_day integer not null default 1,
  created_at timestamptz not null default now()
);

create table hyrox_session_logs (
  id uuid primary key default gen_random_uuid(),
  plan_session_id uuid not null references hyrox_plan_sessions(id),
  user_id uuid not null references users(id),
  status text not null,
  actual_pace text,
  actual_time_seconds integer,
  actual_reps integer,
  rpe integer,
  notes text,
  logged_at timestamptz not null default now()
);

create unique index session_logs_unique
  on hyrox_session_logs (plan_session_id, user_id);

create table hyrox_station_benchmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  station text not null,
  time_seconds integer not null,
  logged_at timestamptz not null default now(),
  source text,
  notes text
);

create index benchmarks_user_station
  on hyrox_station_benchmarks (user_id, station, logged_at);

-- ============================================
-- HYROX: Division Reference Data
-- ============================================

create table hyrox_divisions (
  id uuid primary key default gen_random_uuid(),
  division_key text unique not null,
  category text not null,
  gender_label text not null,
  display_order integer not null
);

create table hyrox_division_stations (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references hyrox_divisions(id) on delete cascade,
  station text not null,
  distance_meters numeric,
  reps integer,
  weight_kg numeric,
  weight_note text
);

create unique index division_stations_unique
  on hyrox_division_stations (division_id, station);

create table hyrox_station_reference_times (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references hyrox_divisions(id) on delete cascade,
  station text not null,
  pro_benchmark_seconds integer not null,
  average_seconds integer not null,
  slow_seconds integer not null,
  source text,
  updated_at timestamptz not null default now()
);

create unique index reference_times_unique
  on hyrox_station_reference_times (division_id, station);

-- ============================================
-- Row Level Security
-- ============================================

-- Enable RLS on all tables
alter table users enable row level security;
alter table accounts enable row level security;
alter table sessions enable row level security;
alter table verification_tokens enable row level security;
alter table communities enable row level security;
alter table community_memberships enable row level security;
alter table movements enable row level security;
alter table workouts enable row level security;
alter table workout_movements enable row level security;
alter table scores enable row level security;
alter table score_movement_details enable row level security;
alter table hyrox_profiles enable row level security;
alter table hyrox_station_assessments enable row level security;
alter table hyrox_training_plans enable row level security;
alter table hyrox_plan_sessions enable row level security;
alter table hyrox_session_logs enable row level security;
alter table hyrox_station_benchmarks enable row level security;
alter table hyrox_divisions enable row level security;
alter table hyrox_division_stations enable row level security;
alter table hyrox_station_reference_times enable row level security;

-- Users: can read/update own row
create policy "users_select_own" on users for select using (auth.uid() = id);
create policy "users_update_own" on users for update using (auth.uid() = id);

-- Allow the auth trigger to insert users (runs as security definer, but needs insert permission)
create policy "users_insert_from_trigger" on users for insert with check (true);

-- Accounts: user can manage own
create policy "accounts_select_own" on accounts for select using (auth.uid() = user_id);
create policy "accounts_insert_own" on accounts for insert with check (auth.uid() = user_id);
create policy "accounts_delete_own" on accounts for delete using (auth.uid() = user_id);

-- Sessions: user can manage own
create policy "sessions_select_own" on sessions for select using (auth.uid() = user_id);
create policy "sessions_insert_own" on sessions for insert with check (auth.uid() = user_id);
create policy "sessions_delete_own" on sessions for delete using (auth.uid() = user_id);

-- Movements: readable by all authenticated users (reference data)
create policy "movements_select_all" on movements for select using (auth.role() = 'authenticated');

-- Workouts: user can manage own, read community workouts
create policy "workouts_select" on workouts for select using (
  auth.uid() = created_by
  or community_id in (
    select community_id from community_memberships where user_id = auth.uid()
  )
);
create policy "workouts_insert_own" on workouts for insert with check (auth.uid() = created_by);
create policy "workouts_update_own" on workouts for update using (auth.uid() = created_by);
create policy "workouts_delete_own" on workouts for delete using (auth.uid() = created_by);

-- Workout movements: follow workout access
create policy "workout_movements_select" on workout_movements for select using (
  workout_id in (select id from workouts where created_by = auth.uid()
    or community_id in (select community_id from community_memberships where user_id = auth.uid()))
);
create policy "workout_movements_insert" on workout_movements for insert with check (
  workout_id in (select id from workouts where created_by = auth.uid())
);
create policy "workout_movements_update" on workout_movements for update using (
  workout_id in (select id from workouts where created_by = auth.uid())
);
create policy "workout_movements_delete" on workout_movements for delete using (
  workout_id in (select id from workouts where created_by = auth.uid())
);

-- Scores: user can manage own, read community scores
create policy "scores_select" on scores for select using (
  auth.uid() = user_id
  or workout_id in (
    select id from workouts where community_id in (
      select community_id from community_memberships where user_id = auth.uid()
    )
  )
);
create policy "scores_insert_own" on scores for insert with check (auth.uid() = user_id);
create policy "scores_update_own" on scores for update using (auth.uid() = user_id);
create policy "scores_delete_own" on scores for delete using (auth.uid() = user_id);

-- Score movement details: follow score access
create policy "score_movement_details_select" on score_movement_details for select using (
  score_id in (select id from scores where user_id = auth.uid())
);
create policy "score_movement_details_insert" on score_movement_details for insert with check (
  score_id in (select id from scores where user_id = auth.uid())
);
create policy "score_movement_details_update" on score_movement_details for update using (
  score_id in (select id from scores where user_id = auth.uid())
);
create policy "score_movement_details_delete" on score_movement_details for delete using (
  score_id in (select id from scores where user_id = auth.uid())
);

-- Communities: members can read, creator can update
create policy "communities_select" on communities for select using (
  id in (select community_id from community_memberships where user_id = auth.uid())
);
create policy "communities_insert" on communities for insert with check (auth.uid() = created_by);
create policy "communities_update" on communities for update using (auth.uid() = created_by);

-- Community memberships: members can see fellow members, users can join/leave
create policy "community_memberships_select" on community_memberships for select using (
  community_id in (select community_id from community_memberships where user_id = auth.uid())
);
create policy "community_memberships_insert" on community_memberships for insert with check (auth.uid() = user_id);
create policy "community_memberships_delete" on community_memberships for delete using (auth.uid() = user_id);

-- HYROX profiles: user can manage own
create policy "hyrox_profiles_select_own" on hyrox_profiles for select using (auth.uid() = user_id);
create policy "hyrox_profiles_insert_own" on hyrox_profiles for insert with check (auth.uid() = user_id);
create policy "hyrox_profiles_update_own" on hyrox_profiles for update using (auth.uid() = user_id);

-- HYROX station assessments: follow profile access
create policy "hyrox_station_assessments_select" on hyrox_station_assessments for select using (
  profile_id in (select id from hyrox_profiles where user_id = auth.uid())
);
create policy "hyrox_station_assessments_insert" on hyrox_station_assessments for insert with check (
  profile_id in (select id from hyrox_profiles where user_id = auth.uid())
);
create policy "hyrox_station_assessments_update" on hyrox_station_assessments for update using (
  profile_id in (select id from hyrox_profiles where user_id = auth.uid())
);

-- HYROX training plans: user can manage own
create policy "hyrox_training_plans_select" on hyrox_training_plans for select using (auth.uid() = user_id);
create policy "hyrox_training_plans_insert" on hyrox_training_plans for insert with check (auth.uid() = user_id);
create policy "hyrox_training_plans_update" on hyrox_training_plans for update using (auth.uid() = user_id);
create policy "hyrox_training_plans_delete" on hyrox_training_plans for delete using (auth.uid() = user_id);

-- HYROX plan sessions: follow plan access
create policy "hyrox_plan_sessions_select" on hyrox_plan_sessions for select using (
  plan_id in (select id from hyrox_training_plans where user_id = auth.uid())
);
create policy "hyrox_plan_sessions_insert" on hyrox_plan_sessions for insert with check (
  plan_id in (select id from hyrox_training_plans where user_id = auth.uid())
);

-- HYROX session logs: user can manage own
create policy "hyrox_session_logs_select" on hyrox_session_logs for select using (auth.uid() = user_id);
create policy "hyrox_session_logs_insert" on hyrox_session_logs for insert with check (auth.uid() = user_id);
create policy "hyrox_session_logs_update" on hyrox_session_logs for update using (auth.uid() = user_id);

-- HYROX station benchmarks: user can manage own
create policy "hyrox_station_benchmarks_select" on hyrox_station_benchmarks for select using (auth.uid() = user_id);
create policy "hyrox_station_benchmarks_insert" on hyrox_station_benchmarks for insert with check (auth.uid() = user_id);

-- HYROX divisions & reference data: readable by all authenticated users
create policy "hyrox_divisions_select" on hyrox_divisions for select using (auth.role() = 'authenticated');
create policy "hyrox_division_stations_select" on hyrox_division_stations for select using (auth.role() = 'authenticated');
create policy "hyrox_station_reference_times_select" on hyrox_station_reference_times for select using (auth.role() = 'authenticated');

-- Verification tokens: service role only (no user policies needed)
