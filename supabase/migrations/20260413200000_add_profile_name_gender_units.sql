-- Add name, gender, and preferred_units to hyrox_profiles
-- These were previously only stored in localStorage during onboarding,
-- meaning returning users had to re-enter them.

ALTER TABLE hyrox_profiles
  ADD COLUMN name TEXT,
  ADD COLUMN gender TEXT,
  ADD COLUMN preferred_units TEXT DEFAULT 'metric';
