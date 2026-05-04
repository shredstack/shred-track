-- Side-cadence concept for parts. Lets a workout pair a "main task" with
-- a recurring on-the-minute movement (e.g. "150 DB hang power cleans for
-- time, EMOM 5 burpees"). The side-cadence movement is performed at the
-- declared interval while the rest of the part forms the main task; the
-- score is tied to the main task.

ALTER TABLE workout_parts
  ADD COLUMN IF NOT EXISTS side_cadence_interval_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS side_cadence_open_ended BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN workout_parts.side_cadence_interval_seconds IS
  'Cadence (e.g. 60 = EMOM) on which the side-cadence movement(s) must be performed concurrently with the main work. Null when the part has no side cadence.';
COMMENT ON COLUMN workout_parts.side_cadence_open_ended IS
  'When true, the part has no fixed duration or time cap — it goes until the athlete can no longer hit the cadence.';

ALTER TABLE workout_movements
  ADD COLUMN IF NOT EXISTS is_side_cadence BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN workout_movements.is_side_cadence IS
  'When true, this movement is performed at the part''s side_cadence_interval (every-minute-on-the-minute style) while the rest of the movements form the main task. Score is tied to the main task.';
