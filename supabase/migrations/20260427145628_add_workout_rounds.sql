-- ============================================
-- Per-part rounds count
-- ============================================
--
-- Captures the round structure for round-based workouts (e.g. "5 rounds for
-- time of: 5 squats, 5 presses"). Rounds belong on the workout/part — reps
-- belong on the movement — so this column lets us encode that cleanly without
-- overloading the free-text rep_scheme field.
--
-- NULL = no fixed rounds (the most common case for For Time / AMRAP / etc.).
-- Mirrored on `workouts` for read-compat with the legacy flat shape.

ALTER TABLE workout_parts
  ADD COLUMN rounds INTEGER;

COMMENT ON COLUMN workout_parts.rounds IS
  'Optional fixed round count (e.g. "5 rounds for time"). NULL = unspecified.';

ALTER TABLE workouts
  ADD COLUMN rounds INTEGER;

COMMENT ON COLUMN workouts.rounds IS
  'Mirror of workout_parts.rounds for the first part (read-compat with legacy shape).';
