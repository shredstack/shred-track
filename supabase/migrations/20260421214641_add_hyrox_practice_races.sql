-- Practice Race Timer tables

CREATE TABLE hyrox_practice_races (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  division_key TEXT,
  template TEXT NOT NULL DEFAULT 'full',
  total_time_seconds NUMERIC(10,1) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX practice_races_user ON hyrox_practice_races(user_id);

CREATE TABLE hyrox_practice_race_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id UUID NOT NULL REFERENCES hyrox_practice_races(id) ON DELETE CASCADE,
  segment_order INTEGER NOT NULL,
  segment_type TEXT NOT NULL,
  segment_label TEXT NOT NULL,
  distance_meters INTEGER,
  reps INTEGER,
  time_seconds NUMERIC(10,1) NOT NULL,
  UNIQUE (race_id, segment_order)
);

CREATE INDEX practice_splits_race ON hyrox_practice_race_splits(race_id);

-- RLS policies
ALTER TABLE hyrox_practice_races ENABLE ROW LEVEL SECURITY;
ALTER TABLE hyrox_practice_race_splits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own practice races"
  ON hyrox_practice_races FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage splits for their own races"
  ON hyrox_practice_race_splits FOR ALL
  USING (race_id IN (SELECT id FROM hyrox_practice_races WHERE user_id = auth.uid()))
  WITH CHECK (race_id IN (SELECT id FROM hyrox_practice_races WHERE user_id = auth.uid()));
