-- Unified CrossFit workout model: collapses workouts + benchmark_workouts +
-- workout_sections into a single template/session pair.
--
-- This migration creates the new tables and indexes alongside the legacy
-- tables. Data is migrated by src/db/seeds/migrate_to_unified_crossfit.ts;
-- once that backfill runs clean, a follow-up migration drops the legacy
-- tables and renames score FKs.
--
-- See claude_code_instructions/crossfit_improvements/unified_crossfit_workout_template_spec.md.

-- ============================================================================
-- crossfit_workouts: one row per distinct workout prescription.
-- ============================================================================

create table crossfit_workouts (
  id uuid primary key default gen_random_uuid(),

  -- Identity
  title text not null,
  description text,
  category text,
  is_benchmark boolean not null default false,
  is_system boolean not null default false,
  weightlifting_movement_id uuid references movements(id) on delete cascade,

  -- Scope. System templates have both null; non-system have exactly one set.
  created_by uuid references users(id),
  community_id uuid references communities(id) on delete cascade,

  -- Dedup key.
  content_fingerprint text not null,

  -- Lineage (self-FK declared below).
  forked_from_crossfit_workout_id uuid,

  -- Workout-level prescription (mirrors the primary part for fast list
  -- rendering without joining the parts tree).
  workout_type text not null,
  time_cap_seconds integer,
  amrap_duration_seconds integer,
  rep_scheme text,
  rounds integer,

  -- Shared prescription metadata
  requires_vest boolean not null default false,
  vest_weight_male_lb numeric,
  vest_weight_female_lb numeric,
  is_partner boolean not null default false,
  partner_count integer,

  -- Coach's notes that travel with the template (e.g., Annie: "one partner
  -- works at a time"). Date-specific notes live on the session.
  coach_notes text,

  -- Template-level calorie estimate at 75 kg reference.
  estimated_kcal_low integer,
  estimated_kcal_high integer,
  estimated_kcal_method text,
  estimated_kcal_confidence text,
  estimated_kcal_computed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table crossfit_workouts
  add constraint crossfit_workouts_forked_from_fkey
  foreign key (forked_from_crossfit_workout_id)
  references crossfit_workouts(id)
  on delete set null;

-- Scope sanity. System benchmarks have both null; non-system templates have
-- exactly one of (created_by, community_id) set.
alter table crossfit_workouts
  add constraint crossfit_workouts_scope_check check (
    (is_system = true)
    or (created_by is not null and community_id is null)
    or (created_by is null and community_id is not null)
  );

-- Dedup constraints (per scope).
create unique index crossfit_workouts_user_fp_unique
  on crossfit_workouts (created_by, content_fingerprint, is_benchmark)
  where created_by is not null;

create unique index crossfit_workouts_community_fp_unique
  on crossfit_workouts (community_id, content_fingerprint, is_benchmark)
  where community_id is not null;

create index crossfit_workouts_benchmark_idx
  on crossfit_workouts (is_benchmark)
  where is_benchmark = true;

create index crossfit_workouts_community_idx
  on crossfit_workouts (community_id)
  where community_id is not null;

create index crossfit_workouts_created_by_idx
  on crossfit_workouts (created_by)
  where created_by is not null;

create index crossfit_workouts_category_idx
  on crossfit_workouts (category)
  where category is not null;

create index crossfit_workouts_weightlifting_movement_idx
  on crossfit_workouts (weightlifting_movement_id)
  where weightlifting_movement_id is not null;

-- ============================================================================
-- crossfit_workout_parts
-- ============================================================================

create table crossfit_workout_parts (
  id uuid primary key default gen_random_uuid(),
  crossfit_workout_id uuid not null
    references crossfit_workouts(id) on delete cascade,
  order_index integer not null,
  label text,
  workout_type text not null,
  time_cap_seconds integer,
  amrap_duration_seconds integer,
  emom_interval_seconds integer,
  rep_scheme text,
  rounds integer,
  structure text,
  interval_work_seconds integer,
  interval_rest_seconds integer,
  interval_rounds jsonb,
  side_cadence_interval_seconds integer,
  side_cadence_open_ended boolean not null default false,
  notes text,
  estimated_kcal_low integer,
  estimated_kcal_high integer,
  estimated_kcal_confidence text,
  created_at timestamptz not null default now(),
  unique (crossfit_workout_id, order_index)
);

create index crossfit_workout_parts_workout_idx
  on crossfit_workout_parts (crossfit_workout_id);

-- ============================================================================
-- crossfit_workout_blocks
-- ============================================================================

create table crossfit_workout_blocks (
  id uuid primary key default gen_random_uuid(),
  crossfit_workout_part_id uuid not null
    references crossfit_workout_parts(id) on delete cascade,
  order_index integer not null,
  title text not null,
  created_at timestamptz not null default now(),
  unique (crossfit_workout_part_id, order_index)
);

create index crossfit_workout_blocks_part_idx
  on crossfit_workout_blocks (crossfit_workout_part_id);

-- ============================================================================
-- crossfit_workout_movements
-- ============================================================================

create table crossfit_workout_movements (
  id uuid primary key default gen_random_uuid(),
  -- Denormalized for fast movement-library aggregate queries.
  crossfit_workout_id uuid not null
    references crossfit_workouts(id) on delete cascade,
  crossfit_workout_part_id uuid not null
    references crossfit_workout_parts(id) on delete cascade,
  crossfit_workout_block_id uuid
    references crossfit_workout_blocks(id) on delete set null,
  movement_id uuid not null references movements(id),
  order_index integer not null,
  prescribed_reps text,
  prescribed_weight_male numeric,
  prescribed_weight_female numeric,
  prescribed_calories_male text,
  prescribed_calories_female text,
  prescribed_distance_male text,
  prescribed_distance_female text,
  prescribed_duration_seconds_male integer,
  prescribed_duration_seconds_female integer,
  prescribed_height_inches numeric,
  prescribed_height_inches_male numeric,
  prescribed_height_inches_female numeric,
  prescribed_weight_male_bw_multiplier numeric,
  prescribed_weight_female_bw_multiplier numeric,
  prescribed_weight_pct numeric,
  prescribed_weight_pct_source_part_id uuid
    references crossfit_workout_parts(id) on delete set null,
  tempo text,
  is_max_reps boolean not null default false,
  is_side_cadence boolean not null default false,
  rep_scheme_parsed jsonb,
  equipment_count integer,
  rx_standard text,
  notes text
);

create index crossfit_workout_movements_workout_idx
  on crossfit_workout_movements (crossfit_workout_id);

create index crossfit_workout_movements_part_idx
  on crossfit_workout_movements (crossfit_workout_part_id);

create index crossfit_workout_movements_movement_idx
  on crossfit_workout_movements (movement_id);

-- ============================================================================
-- workout_sessions: scheduled / logged instance of a template.
-- Replaces both `workouts` and `workout_sections`.
-- ============================================================================

create table workout_sessions (
  id uuid primary key default gen_random_uuid(),

  -- Template the session uses. NULL for freeform sections (warm_up, stretching).
  crossfit_workout_id uuid
    references crossfit_workouts(id) on delete restrict,

  -- Scope. Exactly one is set:
  --   user_id      → personal log
  --   community_id → gym-programmed
  user_id uuid references users(id) on delete cascade,
  community_id uuid references communities(id) on delete cascade,

  workout_date date not null,

  -- Section semantics. For personal logs, kind='wod' and position=0.
  kind text not null default 'wod',
  sub_kind text,
  position integer not null default 0,
  title text,

  -- Freeform body — only used when crossfit_workout_id is NULL.
  body text,

  -- Scoring
  is_scored boolean not null default false,
  score_type text,

  -- Coach's notes for this specific session (renderer concatenates with
  -- the template's notes).
  coach_notes text,

  -- Provenance
  source text not null default 'manual',
  programming_release_id uuid,
  source_track_id uuid references programming_tracks(id) on delete set null,
  published boolean not null default false,
  reviewed_at timestamptz,

  -- Per-session calorie estimate (athlete-bodyweight scaled).
  estimated_kcal_low integer,
  estimated_kcal_high integer,
  estimated_kcal_confidence text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Programming-release back-reference. FK declared after the fact to mirror
-- how the legacy workouts.programming_release_id is currently structured
-- (the type-cycle dance lives in SQL, not Drizzle).
alter table workout_sessions
  add constraint workout_sessions_programming_release_fkey
  foreign key (programming_release_id)
  references programming_releases(id)
  on delete set null;

-- Scope sanity
alter table workout_sessions
  add constraint workout_sessions_scope_check check (
    (user_id is not null and community_id is null)
    or (user_id is null and community_id is not null)
  );

-- Template / body sanity:
--   freeform kinds (warm_up, stretching)  → crossfit_workout_id NULL, body NOT NULL
--   structured kinds                      → crossfit_workout_id NOT NULL
alter table workout_sessions
  add constraint workout_sessions_content_check check (
    (kind in ('warm_up', 'stretching') and crossfit_workout_id is null and body is not null)
    or (kind not in ('warm_up', 'stretching') and crossfit_workout_id is not null)
  );

-- Valid session kinds (mirrors WORKOUT_SESSION_KINDS in schema.ts).
alter table workout_sessions
  add constraint workout_sessions_kind_check check (
    kind in (
      'warm_up',
      'pre_skill',
      'wod',
      'post_skill',
      'stretching',
      'at_home',
      'monthly_challenge',
      'custom'
    )
  );

create index workout_sessions_user_date_idx
  on workout_sessions (user_id, workout_date desc)
  where user_id is not null;

create index workout_sessions_community_date_idx
  on workout_sessions (community_id, workout_date desc)
  where community_id is not null;

create index workout_sessions_template_idx
  on workout_sessions (crossfit_workout_id)
  where crossfit_workout_id is not null;

create index workout_sessions_day_order_idx
  on workout_sessions (community_id, workout_date, position)
  where community_id is not null;

create index workout_sessions_programming_release_idx
  on workout_sessions (programming_release_id)
  where programming_release_id is not null;

create index workout_sessions_source_track_idx
  on workout_sessions (source_track_id)
  where source_track_id is not null;

-- ============================================================================
-- Cross-domain FK additions. Each of these tables has a workout_id pointing
-- at the legacy workouts table. We add a workout_session_id column now (so
-- the backfill can populate it), and a follow-up migration will drop the
-- legacy column after code switches over.
-- ============================================================================

alter table notifications
  add column workout_session_id uuid references workout_sessions(id) on delete cascade,
  add column crossfit_workout_part_id uuid references crossfit_workout_parts(id) on delete cascade;

create index notifications_workout_session_idx
  on notifications (workout_session_id)
  where workout_session_id is not null;

alter table programming_track_days
  add column workout_session_id uuid references workout_sessions(id) on delete set null;

create index programming_track_days_workout_session_idx
  on programming_track_days (workout_session_id)
  where workout_session_id is not null;

alter table class_instances
  add column workout_session_id uuid references workout_sessions(id) on delete set null;

create index class_instances_workout_session_idx
  on class_instances (workout_session_id)
  where workout_session_id is not null;

alter table gym_posts
  add column workout_session_id uuid references workout_sessions(id) on delete set null;

create index gym_posts_workout_session_idx
  on gym_posts (workout_session_id)
  where workout_session_id is not null;

-- ============================================================================
-- Score FK additions. The follow-up drop migration renames the columns
-- once the backfill has populated them and the code has switched over.
-- ============================================================================

alter table scores
  add column workout_session_id uuid references workout_sessions(id) on delete cascade,
  add column crossfit_workout_part_id uuid references crossfit_workout_parts(id) on delete cascade;

create index scores_workout_session_idx
  on scores (workout_session_id)
  where workout_session_id is not null;

create index scores_crossfit_part_idx
  on scores (crossfit_workout_part_id)
  where crossfit_workout_part_id is not null;
