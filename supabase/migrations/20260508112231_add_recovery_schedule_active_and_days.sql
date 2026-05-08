-- Add per-schedule visibility controls so users can keep multiple schedules
-- and pick which ones surface in the calendar/today view, optionally
-- restricted to specific days of the week.
--
-- is_active: when false, the schedule is hidden from today/calendar resolution
--            (existing behavior of isArchived stays separate — archived means
--            "no longer in use", whereas is_active toggles day-to-day display).
-- active_days_of_week: array of 0..6 where 0=Sunday. NULL = every day.
--                      Resolver also treats an empty array as "every day"
--                      so the UI doesn't have to gate on "at least one day
--                      checked" — leave them all unchecked = every day.

ALTER TABLE recovery_schedules
  ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN active_days_of_week INTEGER[];

-- Existing rows default to "active, every day" — preserves current behavior.
