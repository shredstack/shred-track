-- Add nullable plan_session_id FK on hyrox_practice_races so a practice race can
-- link back to a planned training session. Per native-app spec §5.5 / phasing
-- spec §2.1: hyrox_practice_races + hyrox_practice_race_splits is the single
-- source of truth for race-timer output, including races tied to a plan session.

ALTER TABLE hyrox_practice_races
  ADD COLUMN plan_session_id UUID REFERENCES hyrox_plan_sessions(id) ON DELETE SET NULL;

CREATE INDEX practice_races_plan_session ON hyrox_practice_races(plan_session_id);
