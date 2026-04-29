-- ============================================
-- Score Notes Extractions (Phase 4)
-- ============================================
--
-- One row per score, storing the LLM-extracted structured signal pulled out
-- of the free-text `scores.notes` column. Keyed by score so re-extraction on
-- a model-version bump is a clean upsert.
--
-- Extraction is performed by an Inngest cron (see
-- src/inngest/functions/extract-score-notes.ts), gated on `users.is_vip`.
--
-- See claude_code_instructions/crossfit_smart_insights_spec.md §11.

CREATE TABLE score_notes_extractions (
  score_id              uuid PRIMARY KEY REFERENCES scores(id) ON DELETE CASCADE,
  complaints            jsonb NOT NULL,
  scaling_rationale     jsonb NOT NULL,
  milestones            jsonb NOT NULL,
  extracted_at          timestamptz NOT NULL DEFAULT now(),
  model_version         text NOT NULL
);

-- Helps the cron function quickly find scores that haven't been extracted yet
-- (or were extracted by an older model version).
CREATE INDEX score_notes_extractions_model_idx
  ON score_notes_extractions (model_version);

ALTER TABLE score_notes_extractions ENABLE ROW LEVEL SECURITY;

-- Users can only read extractions for their own scores. The score-ownership
-- check happens via the join to `scores`.
CREATE POLICY "Users read own score notes extractions"
  ON score_notes_extractions
  FOR SELECT
  USING (
    score_id IN (
      SELECT id FROM scores WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Service role manages score notes extractions"
  ON score_notes_extractions
  FOR ALL USING (true) WITH CHECK (true);
