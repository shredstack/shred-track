-- Expand community_memberships role model from a single text column into
-- explicit booleans: is_admin (gym admin — rotate code, manage members),
-- is_coach (programmer of gym workouts), and is_active (member's access to
-- gym programming). Backfill: existing role='admin' rows become both admin
-- and coach (they were the only people programming workouts before).

ALTER TABLE community_memberships
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_coach boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

UPDATE community_memberships
SET is_admin = true, is_coach = true
WHERE role = 'admin';

ALTER TABLE community_memberships DROP COLUMN IF EXISTS role;

CREATE INDEX IF NOT EXISTS community_memberships_community_active_idx
  ON community_memberships (community_id) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS community_memberships_role_lookup_idx
  ON community_memberships (user_id, community_id);
