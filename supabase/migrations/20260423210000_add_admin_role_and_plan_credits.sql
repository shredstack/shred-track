-- ============================================
-- Admin role + HYROX plan credits
--
-- Phase 4 of the free/paid HYROX plan feature. Replaces the single-entitlement
-- subscription model with a pay-per-generation model.
--
-- Adds:
--   1. users.is_admin — DB-backed admin flag. ADMIN_EMAILS env continues to
--      work as a bootstrap so the first admin can self-promote and then grant
--      admin to others via the UI.
--   2. hyrox_vip_grants — per-user VIP allowance (N plans per rolling 365 days).
--   3. hyrox_plan_purchases — non-expiring paid credits (one row per RC purchase
--      event). rc_event_id is unique so webhook redelivery is idempotent.
--   4. hyrox_plan_generations — ledger of every personalized plan generation,
--      tagged with the source (vip / purchase / bypass). This is the source of
--      truth for both VIP quota counting and "which purchase was consumed by
--      which plan".
--
-- Note: hyrox_entitlements is intentionally left in place — reserved for a
-- future subscription tier. It is not touched by the pay-per-plan gate.
-- ============================================

BEGIN;

-- ---- Admin role on users ---------------------------------------------------

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin) WHERE is_admin = true;

-- ---- VIP grants ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hyrox_vip_grants (
  user_id           uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plans_per_year    integer NOT NULL CHECK (plans_per_year >= 0),
  active            boolean NOT NULL DEFAULT true,
  granted_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hyrox_vip_grants_active
  ON hyrox_vip_grants(user_id) WHERE active = true;

ALTER TABLE hyrox_vip_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own VIP grant"
  ON hyrox_vip_grants
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Service role manages VIP grants"
  ON hyrox_vip_grants
  FOR ALL USING (true) WITH CHECK (true);

-- ---- Paid purchases --------------------------------------------------------
--
-- One row per successful personalized-plan purchase. rc_event_id is the unique
-- key for webhook idempotency — if RC redelivers the same event, the insert
-- no-ops. amount_cents/currency are stored for audit/reporting; we don't
-- derive behavior from them.

CREATE TABLE IF NOT EXISTS hyrox_plan_purchases (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rc_event_id          text UNIQUE NOT NULL,
  rc_transaction_id    text,
  product_id           text,
  amount_cents         integer,
  currency             text,
  purchased_at         timestamptz NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hyrox_plan_purchases_user
  ON hyrox_plan_purchases(user_id, purchased_at DESC);

ALTER TABLE hyrox_plan_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own purchases"
  ON hyrox_plan_purchases
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Service role manages purchases"
  ON hyrox_plan_purchases
  FOR ALL USING (true) WITH CHECK (true);

-- ---- Generation ledger -----------------------------------------------------
--
-- One row per personalized plan generation kicked off. Used to (a) decrement
-- purchase credits by linking purchase_id when source='purchase', and (b)
-- count VIP usage in the last 365 days when source='vip'.
--
-- source='bypass' rows are recorded when HYROX_PAYWALL_ENFORCED=false so the
-- ledger still has a complete history even in dev.

CREATE TABLE IF NOT EXISTS hyrox_plan_generations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id       uuid REFERENCES hyrox_training_plans(id) ON DELETE SET NULL,
  source        text NOT NULL CHECK (source IN ('vip', 'purchase', 'bypass')),
  -- When source='purchase', points at the purchase row that was consumed. Each
  -- purchase can be linked by at most one generation (unique).
  purchase_id   uuid UNIQUE REFERENCES hyrox_plan_purchases(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hyrox_plan_generations_user_created
  ON hyrox_plan_generations(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hyrox_plan_generations_vip_window
  ON hyrox_plan_generations(user_id, created_at DESC) WHERE source = 'vip';

ALTER TABLE hyrox_plan_generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own generations"
  ON hyrox_plan_generations
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Service role manages generations"
  ON hyrox_plan_generations
  FOR ALL USING (true) WITH CHECK (true);

COMMIT;
