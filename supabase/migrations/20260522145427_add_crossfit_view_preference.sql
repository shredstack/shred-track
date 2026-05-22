-- Persist the CrossFit page view choice ("Gym programming" vs "My personal")
-- on the user row. Previously this lived only in localStorage, so it reset to
-- the default on every app reinstall and never synced across devices.
--
-- Nullable with no default: NULL means "no explicit choice yet", which the
-- client treats as "gym" — preserving the prior default behaviour. Additive
-- column, so this is non-locking and preserves all existing data.
alter table users add column crossfit_view text;
