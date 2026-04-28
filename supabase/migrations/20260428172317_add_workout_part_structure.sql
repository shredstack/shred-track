-- Add a `structure` column to workout_parts so a "For Reps" part can declare
-- a known structural pattern (e.g. Tabata = 8 rounds × :20 work / :10 rest)
-- without inventing a new workout_type. Null means no special structure.

ALTER TABLE workout_parts
  ADD COLUMN structure text;
