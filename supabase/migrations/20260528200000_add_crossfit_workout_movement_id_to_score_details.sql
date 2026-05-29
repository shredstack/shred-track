-- Add the unified-schema FK column to score_movement_details + relax the
-- legacy NOT NULL.
--
-- After the read-path cutover, GET /api/workouts returns
-- crossfit_workout_movements.id as the movement-row id; the score-entry
-- form then echoes that back on POST /api/scores. The existing
-- workout_movement_id column (FK → legacy workout_movements) can no longer
-- be populated for new score details — drop the NOT NULL so the column
-- can be left null, and add the new column the unified writer populates.
--
-- A partial index on the new column mirrors the dedup index strategy used
-- for scores.crossfit_workout_part_id.

alter table score_movement_details
  add column crossfit_workout_movement_id uuid references crossfit_workout_movements(id) on delete cascade,
  alter column workout_movement_id drop not null;

create index if not exists score_movement_details_crossfit_movement_idx
  on score_movement_details (crossfit_workout_movement_id)
  where crossfit_workout_movement_id is not null;
