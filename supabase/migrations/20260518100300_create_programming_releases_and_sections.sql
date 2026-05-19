-- Programming releases + typed workout sections (spec §1.6).
--
-- A programming_release groups a coach's 7-day programming for a gym into a
-- single publishable unit. workout_sections groups workout_parts within a
-- single workout into typed sections (warm-up, pre-skill, WOD, etc.) so
-- the member-facing CrossFit tab can render section cards instead of one
-- flat body, and the TV display can paginate by section.
--
-- The relationship to the existing workouts schema is additive: a workout
-- still has parts → blocks → movements; sections wrap parts via the new
-- workoutParts.workout_section_id FK. Workouts without sections continue
-- to render exactly as before.

CREATE TABLE IF NOT EXISTS programming_releases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id  uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  -- Monday of the programmed week, gym-local timezone.
  week_start    date NOT NULL,
  status        text NOT NULL CHECK (status IN ('draft', 'published')),
  published_at  timestamptz,
  published_by  uuid REFERENCES users(id),
  source        text NOT NULL CHECK (source IN ('cap_import', 'cap_paste', 'manual')),
  source_meta   jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (community_id, week_start)
);

-- programming_tracks is defined here (and not in PR 2) because
-- workout_sections.source_track_id needs a FK target. PR 2 builds the
-- admin UI on top of this schema.
CREATE TABLE IF NOT EXISTS programming_tracks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id     uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('cap', 'monthly_challenge', 'event_prep', 'custom')),
  name             text NOT NULL,
  description      text,
  starts_on        date NOT NULL,
  ends_on          date NOT NULL,
  display_mode     text NOT NULL CHECK (display_mode IN ('inline', 'standalone', 'inline_and_standalone')),
  inline_position  text CHECK (inline_position IN ('top', 'after_wod', 'end_of_day')),
  opt_in_required  boolean NOT NULL DEFAULT false,
  scoring_config   jsonb,
  status           text NOT NULL CHECK (status IN ('draft', 'active', 'archived')) DEFAULT 'draft',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workout_sections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_id      uuid NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN (
                    'warm_up','pre_skill','wod','post_skill','stretching',
                    'at_home','monthly_challenge','custom'
                  )),
  sub_kind        text CHECK (sub_kind IN ('skill','strength','accessory')),
  position        int NOT NULL,
  -- Optional override label; null => derive from kind in the UI.
  title           text,
  is_scored       boolean NOT NULL DEFAULT false,
  score_type      text CHECK (score_type IN ('time','rounds','reps','weight','no_score')),
  -- Set by the coach when they save changes — used by the CAP re-paste
  -- overwrite-protection: re-paste skips days whose sections have
  -- reviewed_at set, so coach edits aren't blown away.
  reviewed_at     timestamptz,
  source_track_id uuid REFERENCES programming_tracks(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workout_sections_workout_id_position
  ON workout_sections(workout_id, position);

-- Wire sections to existing parts. Each workout_part can belong to at most
-- one section; null means "no section" (personal workouts and any pre-PR1
-- gym workout). The cascade ensures deleting a section moves the parts
-- back to section-less (rather than dropping them).
ALTER TABLE workout_parts
  ADD COLUMN IF NOT EXISTS workout_section_id uuid
    REFERENCES workout_sections(id) ON DELETE SET NULL;

ALTER TABLE workouts
  ADD COLUMN IF NOT EXISTS programming_release_id uuid
    REFERENCES programming_releases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
