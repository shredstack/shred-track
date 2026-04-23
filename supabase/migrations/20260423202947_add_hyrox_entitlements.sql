-- ============================================
-- HYROX Entitlements — mirror of RevenueCat subscription state.
--
-- RevenueCat is source of truth. We mirror here via the /api/webhooks/revenuecat
-- webhook so server-side entitlement checks on /api/hyrox/plan/generate (and
-- future personalized features) don't need to call RC for every request.
--
-- One row per (user, entitlement_key) — designed for future entitlements
-- beyond hyrox_personalized_plan.
-- ============================================

BEGIN;

CREATE TABLE IF NOT EXISTS hyrox_entitlements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entitlement_key  text NOT NULL,                                  -- e.g. 'hyrox_personalized_plan'
  active           boolean NOT NULL DEFAULT false,
  expires_at       timestamptz,                                    -- null for lifetime or non-expiring
  product_id       text,                                           -- e.g. 'hyrox_personalized_monthly'
  period_type      text CHECK (period_type IN ('normal', 'trial', 'intro') OR period_type IS NULL),
  -- Last RC event timestamp we processed — lets future idempotency checks
  -- skip out-of-order webhook deliveries.
  last_event_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, entitlement_key)
);

CREATE INDEX IF NOT EXISTS idx_hyrox_entitlements_user_active
  ON hyrox_entitlements(user_id, active);

-- RLS: users can read their own rows; writes are service-role only (webhook).
ALTER TABLE hyrox_entitlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own entitlements"
  ON hyrox_entitlements
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Service role manages entitlements"
  ON hyrox_entitlements
  FOR ALL USING (true) WITH CHECK (true);

COMMIT;
