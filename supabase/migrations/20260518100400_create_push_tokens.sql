-- Push token registry (spec §1.10).
--
-- One row per (user, token). On iOS the device returns an APNS device
-- token; we upsert it on every app launch so a token rotation (after iOS
-- reinstall, app delete, etc.) replaces the old entry. last_seen_at is
-- bumped so a daily cleanup can prune tokens that haven't checked in for
-- 90+ days.

CREATE TABLE IF NOT EXISTS push_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform     text NOT NULL CHECK (platform IN ('ios', 'android')),
  token        text NOT NULL,
  device_id    text,
  app_version  text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS push_tokens_user_id_idx ON push_tokens(user_id);
