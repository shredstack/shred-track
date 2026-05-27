-- Add a notes column to workout_sections so the Smart Builder's "Notes"
-- field persists when a coach composes a section via the programming
-- admin. Direct CrossFit-tab adds continue to use workouts.notes for
-- non-sectioned workouts; this column is the per-section equivalent.

alter table workout_sections
  add column if not exists notes text;
