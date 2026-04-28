-- ============================================
-- User VIP flag + Movement validation flag
--
-- 1. users.is_vip — blanket bypass for paid/AI features. Distinct from
--    is_admin (admin-panel access) and from hyrox_vip_grants (metered HYROX
--    plan allowance, kept around for future per-feature rate limiting). A
--    user with is_vip = true gets every paid feature for free.
--
-- 2. movements.is_validated — distinguishes ShredTrack-curated canonical
--    movements from user-submitted ones. System-seeded movements (created_by
--    IS NULL) are validated by definition. User-created movements default to
--    false; an admin promotes them via the admin movements UI.
-- ============================================

BEGIN;

-- ---- users.is_vip ----------------------------------------------------------

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_vip boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_users_is_vip ON users(is_vip) WHERE is_vip = true;

-- ---- movements.is_validated -----------------------------------------------

ALTER TABLE movements ADD COLUMN IF NOT EXISTS is_validated boolean NOT NULL DEFAULT false;

-- Backfill: every existing system movement (created_by IS NULL) is canonical
-- and considered validated. User-created rows stay at the default (false).
UPDATE movements SET is_validated = true WHERE created_by IS NULL;

CREATE INDEX IF NOT EXISTS idx_movements_pending_validation
  ON movements(created_at)
  WHERE is_validated = false;

-- ---- hyrox_plan_generations: allow source = 'vip_user' --------------------
--
-- Generations consumed by users with users.is_vip=true are recorded with
-- source='vip_user' so the ledger keeps a clean separation from:
--   - 'vip'      → metered hyrox_vip_grants allowance
--   - 'bypass'   → HYROX_PAYWALL_ENFORCED=false (dev/test)
--   - 'purchase' → paid pay-per-plan credit
ALTER TABLE hyrox_plan_generations DROP CONSTRAINT IF EXISTS hyrox_plan_generations_source_check;
ALTER TABLE hyrox_plan_generations
  ADD CONSTRAINT hyrox_plan_generations_source_check
  CHECK (source IN ('vip', 'vip_user', 'purchase', 'bypass'));

COMMIT;
