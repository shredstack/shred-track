-- Add an optional, unique username to users for @-mention autocomplete and
-- profile handles. Per spec §3.6 / Q1: nullable, no backfill, no forced
-- onboarding. Users opt in via their profile page. Mentions resolve by
-- userId, so a missing username does not break mentions — the renderer
-- falls back to the display name.
--
-- See claude_code_instructions/social/crossfit_leaderboard_social_spec.md.

ALTER TABLE users
  ADD COLUMN username text;

-- Unique only among rows that have a value set. Lets us enforce uniqueness
-- without forcing existing users to pick a handle.
--
-- Not CONCURRENTLY: this is a partial index over `WHERE username IS NOT
-- NULL`, and `username` is added in the same migration as nullable with no
-- backfill — so on first deploy the index covers zero rows and builds
-- instantly. CONCURRENTLY would also be incompatible with supabase db push
-- wrapping the migration in a transaction.
CREATE UNIQUE INDEX users_username_unique
  ON users (lower(username))
  WHERE username IS NOT NULL;
