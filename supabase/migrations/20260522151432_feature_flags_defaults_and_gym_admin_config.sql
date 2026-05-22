-- Feature flag changes (see src/lib/feature-flags.ts):
--
--  1. New column `is_gym_admin_configurable`. When true, an active gym
--     admin/coach can toggle the flag for their own gym from the limited
--     /admin/feature-flags view. When false (the default) only super admins
--     can change it. This preserves the existing behaviour for every flag
--     that isn't explicitly opted in below.
--
--  2. Flip `default_value` to ON for every existing flag except the four
--     opt-in features (committed_club, social_feed, hyrox_programming,
--     family_memberships) and `move_to_gym` — a per-user dev flag that
--     should stay off by default.
--
--  3. Mark the four opt-in per-gym features as gym-admin-configurable so
--     gyms can self-serve enabling them.
--
-- All statements are idempotent: the column add is guarded, and the UPDATEs
-- set deterministic values, so re-running has no further effect.

ALTER TABLE feature_flags
  ADD COLUMN IF NOT EXISTS is_gym_admin_configurable boolean NOT NULL DEFAULT false;

-- Default ON for everything except the opt-in flags + the per-user dev flag.
UPDATE feature_flags
SET default_value = 'true'::jsonb
WHERE key NOT IN (
  'committed_club',
  'social_feed',
  'hyrox_programming',
  'family_memberships',
  'move_to_gym'
);

-- Keep these explicitly OFF by default (idempotent — already false today).
UPDATE feature_flags
SET default_value = 'false'::jsonb
WHERE key IN (
  'committed_club',
  'social_feed',
  'hyrox_programming',
  'family_memberships',
  'move_to_gym'
);

-- Gym admins/coaches may toggle these four for their own gym.
UPDATE feature_flags
SET is_gym_admin_configurable = true
WHERE key IN (
  'committed_club',
  'social_feed',
  'hyrox_programming',
  'family_memberships'
);
