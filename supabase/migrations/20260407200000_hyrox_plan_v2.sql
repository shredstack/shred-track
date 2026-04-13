-- ============================================
-- HYROX Training Plan V2
-- Adds AI-generated plans, phases, race scenarios, and plan editing support
-- ============================================

-- 1. Extend hyrox_profiles with new onboarding fields
ALTER TABLE hyrox_profiles ADD COLUMN IF NOT EXISTS goal_finish_time_seconds integer;
ALTER TABLE hyrox_profiles ADD COLUMN IF NOT EXISTS crossfit_days_per_week integer DEFAULT 5;
ALTER TABLE hyrox_profiles ADD COLUMN IF NOT EXISTS crossfit_gym_name text;
ALTER TABLE hyrox_profiles ADD COLUMN IF NOT EXISTS available_equipment text[] DEFAULT '{}';
ALTER TABLE hyrox_profiles ADD COLUMN IF NOT EXISTS injuries_notes text;
ALTER TABLE hyrox_profiles ADD COLUMN IF NOT EXISTS training_philosophy text DEFAULT 'moderate';
ALTER TABLE hyrox_profiles ADD COLUMN IF NOT EXISTS onboarding_version integer DEFAULT 1;

-- 2. Extend hyrox_training_plans with AI generation tracking
ALTER TABLE hyrox_training_plans ADD COLUMN IF NOT EXISTS generation_status text DEFAULT 'pending';
ALTER TABLE hyrox_training_plans ADD COLUMN IF NOT EXISTS inngest_run_id text;
ALTER TABLE hyrox_training_plans ADD COLUMN IF NOT EXISTS ai_model text;
ALTER TABLE hyrox_training_plans ADD COLUMN IF NOT EXISTS training_philosophy jsonb;
ALTER TABLE hyrox_training_plans ADD COLUMN IF NOT EXISTS athlete_snapshot jsonb;

-- 3. Extend hyrox_plan_sessions with AI and editing support
ALTER TABLE hyrox_plan_sessions ADD COLUMN IF NOT EXISTS ai_generated boolean DEFAULT true;
ALTER TABLE hyrox_plan_sessions ADD COLUMN IF NOT EXISTS athlete_modified boolean DEFAULT false;
ALTER TABLE hyrox_plan_sessions ADD COLUMN IF NOT EXISTS original_session_data jsonb;
ALTER TABLE hyrox_plan_sessions ADD COLUMN IF NOT EXISTS session_detail jsonb;
ALTER TABLE hyrox_plan_sessions ADD COLUMN IF NOT EXISTS equipment_required text[] DEFAULT '{}';

-- 4. Create hyrox_plan_phases table
CREATE TABLE IF NOT EXISTS hyrox_plan_phases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES hyrox_training_plans(id) ON DELETE CASCADE,
  phase_number integer NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  start_week integer NOT NULL,
  end_week integer NOT NULL,
  focus_areas text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(plan_id, phase_number)
);

-- 5. Add phase_id FK to plan_sessions (after phases table exists)
ALTER TABLE hyrox_plan_sessions ADD COLUMN IF NOT EXISTS phase_id uuid REFERENCES hyrox_plan_phases(id);

-- 6. Create hyrox_race_scenarios table
CREATE TABLE IF NOT EXISTS hyrox_race_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES hyrox_training_plans(id) ON DELETE CASCADE,
  scenario_label text NOT NULL,
  description text NOT NULL,
  estimated_finish_seconds integer NOT NULL,
  buffer_seconds integer,
  run_strategy text NOT NULL,
  splits jsonb NOT NULL DEFAULT '[]',
  analysis text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- 7. Indexes
CREATE INDEX IF NOT EXISTS idx_hyrox_plan_phases_plan_id ON hyrox_plan_phases(plan_id);
CREATE INDEX IF NOT EXISTS idx_hyrox_race_scenarios_plan_id ON hyrox_race_scenarios(plan_id);
CREATE INDEX IF NOT EXISTS idx_hyrox_plan_sessions_phase_id ON hyrox_plan_sessions(phase_id);

-- 8. RLS policies for new tables
ALTER TABLE hyrox_plan_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE hyrox_race_scenarios ENABLE ROW LEVEL SECURITY;

-- Plan phases: users can read phases for plans they own
CREATE POLICY "Users can read own plan phases" ON hyrox_plan_phases
  FOR SELECT USING (
    plan_id IN (SELECT id FROM hyrox_training_plans WHERE user_id = auth.uid())
  );

CREATE POLICY "Service role can manage plan phases" ON hyrox_plan_phases
  FOR ALL USING (true) WITH CHECK (true);

-- Race scenarios: users can read scenarios for plans they own
CREATE POLICY "Users can read own race scenarios" ON hyrox_race_scenarios
  FOR SELECT USING (
    plan_id IN (SELECT id FROM hyrox_training_plans WHERE user_id = auth.uid())
  );

CREATE POLICY "Service role can manage race scenarios" ON hyrox_race_scenarios
  FOR ALL USING (true) WITH CHECK (true);
