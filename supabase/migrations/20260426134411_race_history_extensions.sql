-- Race history extensions: link benchmarks to races, race type tag, and AI race reports.

-- 1. Link station benchmarks back to the race that produced them.
ALTER TABLE hyrox_station_benchmarks
  ADD COLUMN source_race_id UUID NULL REFERENCES hyrox_practice_races(id) ON DELETE SET NULL;

CREATE INDEX benchmarks_source_race ON hyrox_station_benchmarks(source_race_id);

-- 2. Distinguish practice sims from actual races (drives PR / previous_race_count behaviour).
ALTER TABLE hyrox_practice_races
  ADD COLUMN race_type TEXT NOT NULL DEFAULT 'practice'
    CHECK (race_type IN ('practice', 'actual'));

-- 3. AI race reports (one per race, generated async via Inngest).
CREATE TABLE hyrox_race_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id UUID NOT NULL UNIQUE REFERENCES hyrox_practice_races(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'completed', 'failed')),

  -- AI-generated content
  headline TEXT,
  pacing_analysis TEXT,
  time_loss_ranking JSONB,           -- [{ station, secondsLost, percentile, p25Time }]
  prioritized_focus JSONB,           -- [{ focus, rationale, sessionsPerWeek, durationWeeks }]
  projected_finish_seconds INTEGER,
  projected_finish_assumptions TEXT,

  -- Metadata
  ai_model TEXT,
  generation_started_at TIMESTAMPTZ,
  generation_completed_at TIMESTAMPTZ,
  generation_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX race_reports_user ON hyrox_race_reports(user_id);

ALTER TABLE hyrox_race_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own race reports"
  ON hyrox_race_reports FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 4. Plan recalibration prompt — set when a fresh race shifts the athlete's weak stations.
ALTER TABLE hyrox_training_plans
  ADD COLUMN recalibration_suggested_at TIMESTAMPTZ NULL,
  ADD COLUMN recalibration_source_race_id UUID NULL REFERENCES hyrox_practice_races(id) ON DELETE SET NULL;
