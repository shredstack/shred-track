-- Rotating EMOM support: a per-movement minute/slot index within a repeating
-- cycle (e.g. "EMOM 20: Min 1 max pull-ups / Min 2 max ring dips / Min 3 max
-- sit-ups / Min 4 rest"). NULL for every non-rotating / legacy movement, so
-- this is a safe, non-locking, no-backfill additive change.

alter table crossfit_workout_movements
  add column if not exists slot_index integer;

-- Mirror on the legacy gym-programming movements table so that write path
-- doesn't silently drop the slot assignment.
alter table workout_movements
  add column if not exists slot_index integer;
