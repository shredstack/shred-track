

SELECT count(*) FROM score_movement_details WHERE crossfit_workout_movement_id IS NULL AND workout_movement_id IS NOT NULL;

SELECT smd.set_weights
FROM scores s
JOIN score_movement_details smd ON smd.score_id = s.id
JOIN crossfit_workout_movements cwm ON cwm.id = smd.crossfit_workout_movement_id
JOIN movements m ON m.id = cwm.movement_id
WHERE m.canonical_name = 'Deadlift'
ORDER BY s.created_at DESC;

--select * from crossfit_insights_cache;

