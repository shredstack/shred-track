-- Add optional running assessment fields to hyrox_profiles
-- These are collected during onboarding but were not previously persisted.

ALTER TABLE hyrox_profiles
  ADD COLUMN recent_5k_time_seconds INTEGER,
  ADD COLUMN recent_800m_repeat_seconds INTEGER;
