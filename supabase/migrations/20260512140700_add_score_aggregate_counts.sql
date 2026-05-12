-- Denormalized aggregate counts on scores to keep the gym leaderboard
-- render cheap. Without these we'd need a sub-query per row to count
-- reactions and comments — painful on a 50–100 member gym.
--
-- Transactional bumps in the reaction / comment write paths keep these
-- in sync; a nightly Inngest reconciliation job (see spec §11, commit 14)
-- corrects any drift.

ALTER TABLE scores
  ADD COLUMN reaction_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN comment_count  INTEGER NOT NULL DEFAULT 0;
