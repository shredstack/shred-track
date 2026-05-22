-- weight_pct Rx field
--
-- A movement in a later part can be prescribed as a percentage of the max
-- load logged on an earlier `for_load` part (e.g. Part 2: "max push presses
-- at 60% of the max weight from Part 1"). Two additive, nullable columns on
-- workout_movements:
--
--   prescribed_weight_pct                — the percentage (e.g. 60 for 60%)
--   prescribed_weight_pct_source_part_id — FK to the workout_parts row whose
--                                          logged max load is the basis
--
-- Both nullable, so existing rows are unaffected. The FK is ON DELETE SET
-- NULL: deleting the source part degrades the prescription gracefully (the
-- percentage simply loses its anchor) rather than cascading the dependent
-- movement away.

ALTER TABLE workout_movements
  ADD COLUMN IF NOT EXISTS prescribed_weight_pct numeric,
  ADD COLUMN IF NOT EXISTS prescribed_weight_pct_source_part_id uuid
    REFERENCES workout_parts(id) ON DELETE SET NULL;
