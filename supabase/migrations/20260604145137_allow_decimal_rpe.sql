-- Widen scores.rpe from integer to double precision so the overall RPE can
-- carry the 0.5-grain values produced by averaging per-set RPEs (which have
-- always allowed half-steps). Existing 1-10 integer values cast losslessly.
ALTER TABLE scores
  ALTER COLUMN rpe TYPE double precision USING rpe::double precision;
