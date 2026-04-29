-- ============================================
-- CrossFit Insights Cache (Phase 2)
-- ============================================
--
-- One row per user storing the rendered DomainProfile JSON. The API treats it
-- as an authoritative cache:
--   - source_score_count is compared against count(scores) to detect new
--     writes that bypassed in-process invalidation.
--   - computed_at carries a 24h time fallback so very stale rows recompute
--     even when score_count is unchanged.
--
-- See claude_code_instructions/crossfit_smart_insights_spec.md §9.5.

CREATE TABLE crossfit_insights_cache (
  user_id              uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  domain_profile       jsonb NOT NULL,
  computed_at          timestamptz NOT NULL DEFAULT now(),
  source_score_count   integer NOT NULL
);

ALTER TABLE crossfit_insights_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own crossfit insights cache"
  ON crossfit_insights_cache
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Service role manages crossfit insights cache"
  ON crossfit_insights_cache
  FOR ALL USING (true) WITH CHECK (true);
