-- Programming track days + participations (spec §2.4).
--
-- programming_tracks already exists from PR 1 (§1.6); PR 2 adds the per-day
-- prescription rows and the participation table for opt-in standalone tracks
-- (Murph Prep).

CREATE TABLE IF NOT EXISTS programming_track_days (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id    uuid NOT NULL REFERENCES programming_tracks(id) ON DELETE CASCADE,
  date        date NOT NULL,
  -- Set at publish time when the inline track is injected into a workout.
  -- Standalone tracks may not have a workout_id (members log directly
  -- against the track day).
  workout_id  uuid REFERENCES workouts(id) ON DELETE SET NULL,
  -- Raw prescription text, paste-parser-friendly.
  body        text,
  is_scored   boolean NOT NULL DEFAULT true,
  score_type  text,
  UNIQUE (track_id, date)
);

CREATE INDEX IF NOT EXISTS programming_track_days_track_date_idx
  ON programming_track_days(track_id, date);

CREATE TABLE IF NOT EXISTS programming_track_participations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id   uuid NOT NULL REFERENCES programming_tracks(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  left_at    timestamptz
);

CREATE INDEX IF NOT EXISTS programming_track_participations_user_idx
  ON programming_track_participations(user_id) WHERE left_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS programming_track_participations_unique_active
  ON programming_track_participations(track_id, user_id) WHERE left_at IS NULL;
