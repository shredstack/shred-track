-- ============================================
-- HYROX Public Data Tables
-- For Field Insights + Finish Time Predictor
-- ============================================

-- 1. Public Events
CREATE TABLE hyrox_public_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text UNIQUE NOT NULL,
  name text NOT NULL,
  city text NOT NULL,
  country text NOT NULL,
  region text NOT NULL, -- 'EMEA' | 'NA' | 'APAC'
  event_date date NOT NULL,
  season text NOT NULL, -- e.g. '2024/2025'
  source_url text,
  scraped_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_hyrox_public_events_date ON hyrox_public_events (event_date DESC);
CREATE INDEX idx_hyrox_public_events_country_date ON hyrox_public_events (country, event_date);

-- 2. Public Results (one row per athlete-race finish)
CREATE TABLE hyrox_public_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES hyrox_public_events(id) ON DELETE CASCADE,
  external_result_id text NOT NULL,
  external_athlete_hash text NOT NULL,
  division_key text NOT NULL, -- 'men_open' | 'women_open' | 'men_pro' | 'women_pro'
  age_group text,
  finish_time_seconds integer NOT NULL,
  overall_rank integer NOT NULL,
  division_rank integer NOT NULL,
  field_size_division integer NOT NULL,
  percentile numeric(5,2) NOT NULL,
  is_dnf boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, external_result_id)
);

CREATE INDEX idx_hyrox_public_results_division_event ON hyrox_public_results (division_key, event_id);
CREATE INDEX idx_hyrox_public_results_division_time ON hyrox_public_results (division_key, finish_time_seconds);
CREATE INDEX idx_hyrox_public_results_athlete ON hyrox_public_results (external_athlete_hash);

-- 3. Public Splits (one row per segment per result, ~17 rows per finisher)
CREATE TABLE hyrox_public_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id uuid NOT NULL REFERENCES hyrox_public_results(id) ON DELETE CASCADE,
  segment_order integer NOT NULL,
  segment_type text NOT NULL, -- 'run' | 'station' | 'roxzone'
  segment_label text NOT NULL,
  station_name text, -- one of STATION_ORDER when segment_type='station'
  run_number integer, -- 1..8 when segment_type='run'
  time_seconds integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (result_id, segment_order)
);

CREATE INDEX idx_hyrox_public_splits_result ON hyrox_public_splits (result_id);
CREATE INDEX idx_hyrox_public_splits_station ON hyrox_public_splits (segment_type, station_name);
CREATE INDEX idx_hyrox_public_splits_run ON hyrox_public_splits (segment_type, run_number);

-- 4. Division Aggregates (materialized view)
CREATE MATERIALIZED VIEW hyrox_public_division_aggregates AS
SELECT
  r.division_key,
  r.event_id,
  s.segment_type,
  s.segment_label,
  COUNT(*) AS n,
  AVG(s.time_seconds)::numeric(10,2) AS mean_seconds,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.time_seconds)::numeric(10,2) AS median_seconds,
  PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY s.time_seconds)::numeric(10,2) AS p10,
  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY s.time_seconds)::numeric(10,2) AS p25,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY s.time_seconds)::numeric(10,2) AS p75,
  PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY s.time_seconds)::numeric(10,2) AS p90,
  STDDEV(s.time_seconds)::numeric(10,2) AS stddev_seconds
FROM hyrox_public_splits s
JOIN hyrox_public_results r ON r.id = s.result_id
WHERE r.is_dnf = false
GROUP BY r.division_key, r.event_id, s.segment_type, s.segment_label

UNION ALL

-- "All events" aggregate (event_id = NULL)
SELECT
  r.division_key,
  NULL::uuid AS event_id,
  s.segment_type,
  s.segment_label,
  COUNT(*) AS n,
  AVG(s.time_seconds)::numeric(10,2) AS mean_seconds,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.time_seconds)::numeric(10,2) AS median_seconds,
  PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY s.time_seconds)::numeric(10,2) AS p10,
  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY s.time_seconds)::numeric(10,2) AS p25,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY s.time_seconds)::numeric(10,2) AS p75,
  PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY s.time_seconds)::numeric(10,2) AS p90,
  STDDEV(s.time_seconds)::numeric(10,2) AS stddev_seconds
FROM hyrox_public_splits s
JOIN hyrox_public_results r ON r.id = s.result_id
WHERE r.is_dnf = false
GROUP BY r.division_key, s.segment_type, s.segment_label;

CREATE UNIQUE INDEX idx_hyrox_agg_unique ON hyrox_public_division_aggregates (division_key, COALESCE(event_id, '00000000-0000-0000-0000-000000000000'::uuid), segment_type, segment_label);
CREATE INDEX idx_hyrox_agg_division ON hyrox_public_division_aggregates (division_key);

-- 5. Predictor Models
CREATE TABLE hyrox_predictor_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_key text NOT NULL,
  model_type text NOT NULL, -- 'rf_percentile' | 'gbm_finish_time' | 'gbm_finish_time_q10' | 'gbm_finish_time_q90'
  trained_at timestamptz NOT NULL DEFAULT now(),
  training_n integer NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}',
  feature_importances jsonb NOT NULL DEFAULT '[]',
  artifact_url text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_hyrox_predictor_models_active ON hyrox_predictor_models (division_key, model_type) WHERE is_active = true;

-- 6. User Predictions
CREATE TABLE hyrox_user_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  division_key text NOT NULL,
  predicted_finish_seconds integer NOT NULL,
  predicted_finish_low integer NOT NULL,
  predicted_finish_high integer NOT NULL,
  predicted_percentile numeric(5,2) NOT NULL,
  confidence numeric(3,2) NOT NULL,
  contributing_signals jsonb NOT NULL DEFAULT '{}',
  bottleneck_station text,
  bottleneck_savings_seconds integer,
  model_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- RLS Policies
-- ============================================

ALTER TABLE hyrox_public_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hyrox_public_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE hyrox_public_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE hyrox_predictor_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE hyrox_user_predictions ENABLE ROW LEVEL SECURITY;

-- Public tables: readable by everyone, writable only by service role
CREATE POLICY "Public events readable by all" ON hyrox_public_events FOR SELECT USING (true);
CREATE POLICY "Public results readable by all" ON hyrox_public_results FOR SELECT USING (true);
CREATE POLICY "Public splits readable by all" ON hyrox_public_splits FOR SELECT USING (true);
CREATE POLICY "Predictor models readable by all" ON hyrox_predictor_models FOR SELECT USING (true);

-- User predictions: users can read/upsert their own row only
CREATE POLICY "Users read own predictions" ON hyrox_user_predictions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own predictions" ON hyrox_user_predictions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own predictions" ON hyrox_user_predictions FOR UPDATE USING (auth.uid() = user_id);
