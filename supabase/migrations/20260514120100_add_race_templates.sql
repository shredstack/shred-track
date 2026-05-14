-- Reusable HYROX race timer templates.
--
-- Users who like a particular custom race shape (e.g. "200m runs, 6
-- stations, no sled") can save it as a named template and reuse it
-- with one tap instead of rebuilding the segment list every time.
--
-- The segments payload is a JSONB array of the same shape the timer
-- already serializes for completed-race splits (see RaceSegment in
-- src/components/hyrox/race-timer/types.ts). We store it opaquely so
-- new segment-level fields automatically propagate without a schema
-- migration.

CREATE TABLE hyrox_race_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  division_key TEXT,
  simulate_roxzone BOOLEAN NOT NULL DEFAULT false,
  segments JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX race_templates_user ON hyrox_race_templates(user_id, created_at DESC);

ALTER TABLE hyrox_race_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own race templates"
  ON hyrox_race_templates FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
