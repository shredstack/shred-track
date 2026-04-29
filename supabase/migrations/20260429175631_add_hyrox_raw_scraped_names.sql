-- ============================================
-- HYROX: Raw scraped name list for recovery
-- ============================================
-- Adds `raw_scraped_names` to hyrox_public_results — the untruncated list
-- of <td class="last"> cells from the athlete detail page (member names
-- followed by metadata cells like age group, ranks, etc.).
--
-- `athlete_names_normalized` is the cleaned, truncated, normalized form
-- used for search. `raw_scraped_names` is the source of truth: if the
-- truncation/normalization rules change, we can backfill from this column
-- instead of re-scraping.
--
-- Existing rows get an empty array; the scraper backfills on next run.
-- The scraper's per-event skip-check (in `get_event_result_counts`) is
-- being switched to consider a division stale when `raw_scraped_names`
-- is empty, so empty-by-default rows trigger a re-scrape automatically.

ALTER TABLE hyrox_public_results
  ADD COLUMN raw_scraped_names text[] NOT NULL DEFAULT '{}'::text[];
