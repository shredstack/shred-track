-- ============================================
-- HYROX: Name search + user race claims
-- ============================================
-- Adds the data needed for users to search public race results by athlete
-- name and "claim" results as their own. Claims are trust-based: users
-- attest the result is theirs (with a disclaimer); we don't verify.
--
-- Multiple users can claim the same public_result_id when the division is
-- doubles or relay (enforced at the API based on DIVISIONS[divisionKey].athletes).
-- The unique(user_id, public_result_id) constraint prevents one user
-- claiming the same result twice.
--
-- The new athlete_names_normalized column on hyrox_public_results holds one
-- entry per team member: lowercased, accent-stripped, punctuation-stripped,
-- whitespace-collapsed (e.g. "Wells, Sydney" -> "wells sydney"). Existing
-- rows get an empty array; the scraper backfills on next run.

-- 1. Per-member normalized name array on results
ALTER TABLE hyrox_public_results
  ADD COLUMN athlete_names_normalized text[] NOT NULL DEFAULT '{}'::text[];

-- GIN index supports `WHERE athlete_names_normalized && ARRAY['sarah dorich']`
-- and `@>` containment in API search queries.
CREATE INDEX idx_hyrox_public_results_names_gin
  ON hyrox_public_results USING gin (athlete_names_normalized);

-- 2. User claims of public race results
CREATE TABLE user_public_race_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_result_id uuid NOT NULL REFERENCES hyrox_public_results(id) ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  disclaimer_acked_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX user_public_race_claims_user_result_unique
  ON user_public_race_claims (user_id, public_result_id);
CREATE INDEX idx_user_public_race_claims_user
  ON user_public_race_claims (user_id);
CREATE INDEX idx_user_public_race_claims_result
  ON user_public_race_claims (public_result_id);

-- 3. RLS — claims are user-owned
ALTER TABLE user_public_race_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own race claims"
  ON user_public_race_claims FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own race claims"
  ON user_public_race_claims FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own race claims"
  ON user_public_race_claims FOR DELETE
  USING (auth.uid() = user_id);

-- Service role bypasses RLS for backend operations (matching, backfills).
CREATE POLICY "Service role manages race claims"
  ON user_public_race_claims FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
