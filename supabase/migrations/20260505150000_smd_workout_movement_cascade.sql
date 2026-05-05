-- Make score_movement_details.workout_movement_id cascade on delete.
-- Previously it defaulted to NO ACTION, so deleting a workout could fail
-- when any score on that workout had movement-detail rows: the cascade
-- chain would try to remove the workout_movements rows while
-- score_movement_details still referenced them, violating the FK.

ALTER TABLE score_movement_details
  DROP CONSTRAINT smd_workout_movement_id_fk;

ALTER TABLE score_movement_details
  ADD CONSTRAINT smd_workout_movement_id_fk
    FOREIGN KEY (workout_movement_id)
    REFERENCES workout_movements(id)
    ON DELETE CASCADE;
