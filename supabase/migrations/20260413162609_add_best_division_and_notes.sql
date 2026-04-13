-- Add best_division and best_time_notes to hyrox_profiles
-- best_division stores the division the athlete raced in (including doubles/relay)
-- best_time_notes stores free-text context about the race performance

ALTER TABLE hyrox_profiles
  ADD COLUMN best_division TEXT,
  ADD COLUMN best_time_notes TEXT;
