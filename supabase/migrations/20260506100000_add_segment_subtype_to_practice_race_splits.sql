-- Add a segment_subtype discriminator to hyrox_practice_race_splits to
-- distinguish Roxzone (transition-simulation) runs from prescribed 1km runs.
--
-- NULL means "prescribed_run" semantically; existing rows stay NULL forever.
-- New roxzone-mode races write 'roxzone' for the inserted segments and may
-- optionally write 'prescribed_run' for the 1km runs. Station rows always
-- stay NULL — the discriminator is meaningful only on run segments.

ALTER TABLE hyrox_practice_race_splits
  ADD COLUMN segment_subtype TEXT;

ALTER TABLE hyrox_practice_race_splits
  ADD CONSTRAINT hyrox_practice_race_splits_segment_subtype_check
  CHECK (segment_subtype IS NULL OR segment_subtype IN ('prescribed_run', 'roxzone'));
