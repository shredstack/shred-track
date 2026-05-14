-- Custom HYROX race support: store per-segment weight on splits, and
-- distance / reps / weight on station benchmarks so PR comparisons can
-- be apples-to-apples instead of raw-time only.
--
-- All columns are nullable and there is no backfill: NULL on these
-- columns means "assume the canonical value for the source race's
-- division" — which preserves the behavior of every existing row.
--
-- Splits already have distance_meters and reps columns from earlier
-- work; this migration just adds weight.

ALTER TABLE hyrox_practice_race_splits
  ADD COLUMN weight_kg numeric,
  ADD COLUMN weight_label text;

ALTER TABLE hyrox_station_benchmarks
  ADD COLUMN distance_meters integer,
  ADD COLUMN reps integer,
  ADD COLUMN weight_kg numeric,
  ADD COLUMN weight_label text;
