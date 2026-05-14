-- AI race reports carry a "projected finish" number that means different
-- things for canonical (Full/Half) races vs custom races. For canonical
-- races it is "your finish if you fix your top time-loss segments"
-- ("improvement"). For custom races — which may have dropped stations
-- and shortened distances — it is "your full-HYROX finish if you held
-- this pace" ("extrapolation").
--
-- Persisting which kind of projection produced the number lets the UI
-- pick the right label and the right copy so the user doesn't get a
-- misleadingly small "Projected finish" after a 6-station custom race.
--
-- Nullable + no default: legacy rows pre-dating this change carry NULL
-- and the UI falls back to the existing "Projected finish" wording for
-- them.

ALTER TABLE hyrox_race_reports
  ADD COLUMN projection_type text;
