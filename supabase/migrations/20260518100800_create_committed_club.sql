-- Committed Club leaderboard + streak cache (spec §2.5).
--
-- Computed-not-stored for the live month: getCurrentMonthProgress counts
-- class_registrations where status='attended' for the user in the
-- gym-local month. End-of-month snapshot is materialized for historical
-- leaderboards so we don't have to query class_registrations across years.

CREATE TABLE IF NOT EXISTS committed_club_snapshots (
  community_id     uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  year_month       text NOT NULL,  -- '2026-05'
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rank             int NOT NULL,
  classes_attended int NOT NULL,
  -- When the user crossed the threshold this month; null if they didn't.
  first_in_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, year_month, user_id)
);

CREATE INDEX IF NOT EXISTS committed_club_snapshots_leaderboard_idx
  ON committed_club_snapshots(community_id, year_month, rank);

CREATE TABLE IF NOT EXISTS user_streak_cache (
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  community_id         uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  current_streak       int NOT NULL DEFAULT 0,
  longest_streak       int NOT NULL DEFAULT 0,
  last_qualified_month text,  -- '2026-04'
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, community_id)
);

-- Per-gym configurable threshold (default 15 classes/month).
ALTER TABLE communities
  ADD COLUMN IF NOT EXISTS committed_club_threshold int NOT NULL DEFAULT 15;
