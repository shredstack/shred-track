-- ============================================
-- Score Notes Extractions — content_hash
-- ============================================
--
-- Adds a content_hash so we can re-extract when the underlying notes (or
-- workout context we send to the LLM) change. With model_version + this hash
-- as a joint freshness key, edits to either kind of note retrigger
-- extraction on the next cron tick.
--
-- See claude_code_instructions/crossfit_smart_insights_spec.md §11.

ALTER TABLE score_notes_extractions
  ADD COLUMN content_hash text;

-- Existing rows have no hash → treated as stale → re-extracted on next run.
-- That's the desired behavior, so no backfill.
