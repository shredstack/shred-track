-- Per-gym feature flag gating all gym-triggered notifications: workout
-- programming publish (`workout_published`), social posts
-- (`social_post_published`), and social mentions (`social_post_mention`).
--
-- Default OFF for existing gyms so they don't start blasting their
-- members on deploy. Gym-admin-configurable so admins can opt in from
-- /admin/feature-flags without a super-admin in the loop.

INSERT INTO feature_flags (
  key,
  description,
  default_value,
  is_per_gym,
  is_per_user,
  is_gym_admin_configurable
) VALUES (
  'gym_notifications',
  'Send gym-triggered notifications (programming publish, social posts, mentions)',
  'false'::jsonb,
  true,
  false,
  true
)
ON CONFLICT (key) DO NOTHING;
