-- Feature flag system. Three tables:
--   feature_flags                  — registry of known flag keys + defaults
--   community_feature_overrides    — per-gym overrides (admin UI flips here)
--   user_feature_overrides         — per-user overrides (rare; mostly devs)
--
-- Resolution order at read time: user override → community override → default.
-- Memoized per request in src/lib/feature-flags.ts via React's cache().

CREATE TABLE IF NOT EXISTS feature_flags (
  key            text PRIMARY KEY,
  description    text,
  default_value  jsonb NOT NULL,
  is_per_gym     boolean NOT NULL DEFAULT false,
  is_per_user    boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS community_feature_overrides (
  community_id  uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  flag_key      text NOT NULL REFERENCES feature_flags(key) ON DELETE CASCADE,
  value         jsonb NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, flag_key)
);

CREATE TABLE IF NOT EXISTS user_feature_overrides (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flag_key    text NOT NULL REFERENCES feature_flags(key) ON DELETE CASCADE,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, flag_key)
);

-- Seed the flags we know we'll need across PR 1–3 of the CFD readiness work.
-- All default off; flip on per-gym via /admin/feature-flags.
INSERT INTO feature_flags (key, description, default_value, is_per_gym, is_per_user) VALUES
  ('gym_programming',         'CAP-style typed-section programming flow',  'false'::jsonb, true,  false),
  ('cap_paste_import',        'CAP paste-parser in programming admin',     'false'::jsonb, true,  false),
  ('class_display_mode',      'TV display route at /gym/display/[date]',   'false'::jsonb, true,  false),
  ('classes',                 'Class schedules + registration',            'false'::jsonb, true,  false),
  ('social_feed',             'Gym social board',                          'false'::jsonb, true,  false),
  ('committed_club',          'Committed Club leaderboard + progress',     'false'::jsonb, true,  false),
  ('programming_tracks',      'Monthly challenges + Murph Prep as tracks', 'false'::jsonb, true,  false),
  ('events',                  'Events as special class instances',         'false'::jsonb, true,  false),
  ('documents',               'Waiver / document signing',                 'false'::jsonb, true,  false),
  ('auto_anniversary_posts',  'Haiku anniversary/birthday auto-posts',     'false'::jsonb, true,  false),
  ('whiteboard_linking',      'Link whiteboard photos to workouts',        'false'::jsonb, true,  false),
  ('coach_mode_toggle',       'Coach/Member view toggle in header',        'false'::jsonb, true,  false),
  ('move_to_gym',             'Allow moving a personal workout into a gym','false'::jsonb, false, true)
ON CONFLICT (key) DO NOTHING;
