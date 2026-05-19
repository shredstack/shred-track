-- Custom Tracks v2 (spec §1.1, §2.1, §3.2).
--
-- 1. Allow 'before_at_home' as an inline_position so monthly challenges
--    can land between Stretching and At-Home as Sarah requested.
--    Backfills existing monthly_challenge rows to the new position.
-- 2. Adds a new track_day_scores table for non-WOD per-day scoring
--    (sit-up reps, daily step counts, grams of veggies, etc.).
-- 3. Seeds the custom_tracks_v2 feature flag.

-- ============================================
-- §1.1 inline_position enum + backfill
-- ============================================

ALTER TABLE programming_tracks
  DROP CONSTRAINT IF EXISTS programming_tracks_inline_position_check;
ALTER TABLE programming_tracks
  ADD CONSTRAINT programming_tracks_inline_position_check
    CHECK (
      inline_position IS NULL
      OR inline_position IN ('top', 'after_wod', 'before_at_home', 'end_of_day')
    );

-- Monthly challenges previously defaulted to 'after_wod' or 'end_of_day'.
-- Move every active monthly_challenge into the new slot between Stretching
-- and At-Home (the section injector falls through to end_of_day on days
-- that have no At-Home section).
UPDATE programming_tracks
   SET inline_position = 'before_at_home',
       updated_at = now()
 WHERE kind = 'monthly_challenge'
   AND (inline_position IS NULL OR inline_position IN ('after_wod', 'end_of_day'));

-- ============================================
-- §3.2 track_day_scores
-- ============================================

CREATE TABLE IF NOT EXISTS track_day_scores (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_day_id  uuid NOT NULL REFERENCES programming_track_days(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Nullable so a track configured with allowJustDone can record a
  -- "did it" tap without a number.
  numeric_value numeric,
  -- Escape hatch for free-form values (e.g. "felt good", "PR!"). Kept
  -- separate from notes for searchability.
  text_value    text,
  -- Denormalized from the parent track's scoring_config at log time so
  -- a coach changing the unit mid-month doesn't retroactively rewrite
  -- past scores. Deliberate denormalization.
  unit          text,
  is_complete   boolean NOT NULL DEFAULT true,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (track_day_id, user_id)
);

CREATE INDEX IF NOT EXISTS track_day_scores_user_idx
  ON track_day_scores (user_id, created_at DESC);

-- ============================================
-- §4.4 feature flag seed
-- ============================================

INSERT INTO feature_flags (key, description, default_value, is_per_gym)
VALUES
  (
    'custom_tracks_v2',
    'Calendar-based track authoring + opt-in athlete tracks + per-day scoring',
    'false'::jsonb,
    true
  )
ON CONFLICT (key) DO NOTHING;
