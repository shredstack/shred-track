-- Evolve score_movement_details.set_weights from number[] (legacy) to
-- [{ weight, reps?, rpe? }] (new shape). Idempotent: skips rows already
-- migrated by checking the type of the first array element.
--
-- Old: [225, 235, 245]
-- New: [{"weight": 225}, {"weight": 235}, {"weight": 245}]
--
-- Reps and RPE are intentionally NOT backfilled — the predictor still
-- has a fallback path that reads reps from the workout's repScheme for
-- legacy entries that lack per-set reps.

UPDATE score_movement_details
SET set_weights = (
  SELECT jsonb_agg(jsonb_build_object('weight', value))
  FROM jsonb_array_elements(set_weights) AS value
)
WHERE set_weights IS NOT NULL
  AND jsonb_typeof(set_weights) = 'array'
  AND jsonb_array_length(set_weights) > 0
  AND jsonb_typeof(set_weights -> 0) = 'number';
