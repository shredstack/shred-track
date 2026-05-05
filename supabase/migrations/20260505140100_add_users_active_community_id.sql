-- Add users.active_community_id so the user's currently-selected gym
-- persists across devices. Nullable — null means "personal mode" (no gym
-- selected). The localStorage mirror in the client lets the dropdown
-- render synchronously without a fetch.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS active_community_id uuid
    REFERENCES communities(id) ON DELETE SET NULL;
