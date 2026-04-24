-- ============================================
-- Per-movement equipment count
-- ============================================
--
-- Captures the number of implements used for a single rep of a movement
-- (e.g. 1 vs 2 dumbbells for "DB Deadlift"). NULL means unspecified (legacy
-- rows and anything where the count is implicit / non-applicable).
--
-- When equipment_count > 1, UI renders prescribed weight as "2 × 50 lb"
-- instead of a bare "50 lb".

ALTER TABLE workout_movements
  ADD COLUMN equipment_count INTEGER;

COMMENT ON COLUMN workout_movements.equipment_count IS
  'Number of implements per rep (e.g. 2 for two-dumbbell lifts). NULL = unspecified / non-applicable.';
