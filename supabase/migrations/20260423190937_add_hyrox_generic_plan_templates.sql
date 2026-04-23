-- ============================================
-- HYROX Free Plan — Generic Plan Templates
--
-- Introduces 3 tables to hold canonical (pre-built, non-personalized)
-- training plan templates that power the free onboarding flow.
-- Also adds columns to hyrox_profiles to track which onboarding flow a
-- user went through and whether they accepted the generic-plan disclaimer.
--
-- Design notes:
-- - All values stored in canonical units: weights in kg, distances in
--   meters, run paces as seconds_per_km, machine paces as seconds_per_500m.
-- - Display conversion happens at render time via convertWeightLabel(),
--   formatMovementPrescription(), and the user's UnitToggle preference.
-- - Templates are split Open/Pro on the parent row (40 rows = 24 logical
--   plans × 1–2 weight tiers). Sessions reference their parent template,
--   and the parent's weight_tier determines the Rx weights baked into
--   session_detail movements.
-- ============================================

BEGIN;

-- =========================================================================
-- 1. Extend hyrox_profiles
-- =========================================================================

ALTER TABLE hyrox_profiles
  ADD COLUMN IF NOT EXISTS pace_tier text
  CHECK (pace_tier IS NULL OR pace_tier IN ('beginner', 'intermediate', 'advanced', 'elite'));

ALTER TABLE hyrox_profiles
  ADD COLUMN IF NOT EXISTS plan_tier text NOT NULL DEFAULT 'free'
  CHECK (plan_tier IN ('free', 'personalized'));

ALTER TABLE hyrox_profiles
  ADD COLUMN IF NOT EXISTS disclaimer_accepted_at timestamptz;

-- =========================================================================
-- 2. hyrox_generic_plan_templates — one row per (template_key, weight_tier)
-- =========================================================================

CREATE TABLE IF NOT EXISTS hyrox_generic_plan_templates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key        text NOT NULL,                          -- e.g. 'women_singles_intermediate'
  gender              text NOT NULL CHECK (gender IN ('women', 'men')),
  race_format         text NOT NULL CHECK (race_format IN ('singles', 'doubles', 'relay')),
  pace_tier           text NOT NULL CHECK (pace_tier IN ('beginner', 'intermediate', 'advanced', 'elite')),
  weight_tier         text NOT NULL CHECK (weight_tier IN ('open', 'pro')),
  total_weeks         integer NOT NULL DEFAULT 18,
  title               text NOT NULL,
  training_philosophy text NOT NULL,
  version             integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_key, weight_tier)
);

-- =========================================================================
-- 3. hyrox_generic_plan_template_phases
-- =========================================================================

CREATE TABLE IF NOT EXISTS hyrox_generic_plan_template_phases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  uuid NOT NULL REFERENCES hyrox_generic_plan_templates(id) ON DELETE CASCADE,
  phase_number integer NOT NULL,
  name         text NOT NULL,
  description  text NOT NULL,
  start_week   integer NOT NULL,
  end_week     integer NOT NULL,
  focus_areas  text[] NOT NULL DEFAULT '{}',
  UNIQUE (template_id, phase_number)
);

-- =========================================================================
-- 4. hyrox_generic_plan_template_sessions
-- =========================================================================

CREATE TABLE IF NOT EXISTS hyrox_generic_plan_template_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id         uuid NOT NULL REFERENCES hyrox_generic_plan_templates(id) ON DELETE CASCADE,
  week                integer NOT NULL CHECK (week BETWEEN 1 AND 18),
  day_of_week         integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  order_in_day        integer NOT NULL DEFAULT 1,
  session_type        text NOT NULL CHECK (session_type IN ('station_skills', 'run', 'hyrox_day', 'rest')),
  title               text NOT NULL,
  description         text NOT NULL,
  pace_spec           jsonb,                                  -- { kind, seconds, range? }
  duration_minutes    integer,
  session_detail      jsonb NOT NULL,                         -- { warmup, blocks: [...], cooldown, coachNotes, estimatedDuration }
  equipment_required  text[] NOT NULL DEFAULT '{}',
  phase_number        integer NOT NULL,
  UNIQUE (template_id, week, day_of_week, order_in_day)
);

-- =========================================================================
-- 5. Indexes
-- =========================================================================

CREATE INDEX IF NOT EXISTS idx_generic_plan_sessions_template_week
  ON hyrox_generic_plan_template_sessions(template_id, week);

CREATE INDEX IF NOT EXISTS idx_generic_plan_templates_lookup
  ON hyrox_generic_plan_templates(gender, race_format, pace_tier, weight_tier);

-- =========================================================================
-- 6. RLS — templates are global reference data, readable by authenticated
-- users, writable only by service role.
-- =========================================================================

ALTER TABLE hyrox_generic_plan_templates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE hyrox_generic_plan_template_phases   ENABLE ROW LEVEL SECURITY;
ALTER TABLE hyrox_generic_plan_template_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read generic plan templates"
  ON hyrox_generic_plan_templates
  FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'anon');

CREATE POLICY "Service role can manage generic plan templates"
  ON hyrox_generic_plan_templates
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can read generic plan phases"
  ON hyrox_generic_plan_template_phases
  FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'anon');

CREATE POLICY "Service role can manage generic plan phases"
  ON hyrox_generic_plan_template_phases
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can read generic plan sessions"
  ON hyrox_generic_plan_template_sessions
  FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'anon');

CREATE POLICY "Service role can manage generic plan sessions"
  ON hyrox_generic_plan_template_sessions
  FOR ALL USING (true) WITH CHECK (true);

COMMIT;
