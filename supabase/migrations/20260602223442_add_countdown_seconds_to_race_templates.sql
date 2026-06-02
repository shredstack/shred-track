-- Encode the pre-race countdown into each saved HYROX race template so a
-- watch-initiated race using a template can honor the author's choice
-- instead of always falling back to the watch's hardcoded default.
--
-- NULL means "no template-specified value" — readers fall back to the
-- device's standing preference (the existing localStorage / watch
-- default behavior). Allowed non-null values mirror the picker options
-- in src/hooks/useCountdownPreference.ts (0, 3, 5, 10).

ALTER TABLE hyrox_race_templates
  ADD COLUMN countdown_seconds smallint
  CHECK (countdown_seconds IS NULL OR countdown_seconds IN (0, 3, 5, 10));
