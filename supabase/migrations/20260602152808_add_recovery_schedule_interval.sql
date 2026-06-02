-- Adds an "every N days" recurrence option to recovery schedules, alongside
-- the existing "every day" and "specific days of week" modes.
--
-- interval_days + interval_starts_on are mutually exclusive with
-- active_days_of_week in the UI: a schedule recurs either on certain weekdays
-- OR on a fixed N-day cadence from a start date — not both. The resolver
-- treats interval_days as the dominant rule when set.
--
-- interval_days NULL  => no interval-based recurrence (fall back to
--                        active_days_of_week semantics).
-- interval_days >= 1  => show only on dates where
--                        (days_since(date, interval_starts_on) % interval_days) = 0.

ALTER TABLE recovery_schedules
  ADD COLUMN interval_days INTEGER,
  ADD COLUMN interval_starts_on DATE;

ALTER TABLE recovery_schedules
  ADD CONSTRAINT recovery_schedules_interval_days_positive
    CHECK (interval_days IS NULL OR interval_days >= 1);

ALTER TABLE recovery_schedules
  ADD CONSTRAINT recovery_schedules_interval_requires_start
    CHECK ((interval_days IS NULL) = (interval_starts_on IS NULL));
