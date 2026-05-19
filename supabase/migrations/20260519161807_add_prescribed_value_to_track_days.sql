-- Custom Tracks v2 follow-up.
--
-- Adds a structured `prescribed_value` to programming_track_days so the
-- athlete-facing "Mark done" tap on monthly-challenge days can auto-fill
-- the prescribed amount (e.g. tap Done on a 40-sit-ups day → score row
-- gets numeric_value=40 so the monthly sum counts it).
--
-- The progression generator already knows the per-day reps; previously
-- that number was only baked into the prose `body` (e.g. "40 sit-ups")
-- and lost on persistence. Storing it structurally lets clients read it
-- back without parsing prose.

ALTER TABLE programming_track_days
  ADD COLUMN IF NOT EXISTS prescribed_value numeric;
