-- Social tables for the CrossFit gym leaderboard: reactions, comments,
-- notifications, and per-user notification preferences. All four tables
-- get RLS enabled with policies scoped to gym membership, mirroring the
-- pattern in 20260505130000_workout_blocks.sql.
--
-- Per spec §3, attachment columns on score_comments are included even
-- though they aren't used until commit 15 (Klipy proxy) — bundling them
-- now avoids a follow-up migration when GIFs ship.
--
-- See claude_code_instructions/social/crossfit_leaderboard_social_spec.md.

-- ============================================
-- score_reactions
-- ============================================

CREATE TABLE IF NOT EXISTS score_reactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  score_id    UUID NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction    TEXT NOT NULL DEFAULT 'fire',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT score_reactions_unique UNIQUE (score_id, user_id, reaction)
);

CREATE INDEX IF NOT EXISTS score_reactions_score_idx ON score_reactions (score_id);
CREATE INDEX IF NOT EXISTS score_reactions_user_idx  ON score_reactions (user_id);

ALTER TABLE score_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "score_reactions_select" ON score_reactions FOR SELECT USING (
  score_id IN (
    SELECT s.id FROM scores s
    INNER JOIN workouts w ON s.workout_id = w.id
    WHERE w.created_by = auth.uid()
       OR w.community_id IN (
         SELECT community_id FROM community_memberships
         WHERE user_id = auth.uid() AND is_active = true
       )
  )
);

CREATE POLICY "score_reactions_insert" ON score_reactions FOR INSERT WITH CHECK (
  user_id = auth.uid()
);

CREATE POLICY "score_reactions_delete" ON score_reactions FOR DELETE USING (
  user_id = auth.uid()
);

-- ============================================
-- score_comments
-- ============================================
--
-- Body stores plain text with [mention:<userId>] tokens; the client
-- resolves these to display names at render time so renaming a user
-- doesn't leave stale mentions in old comments.
--
-- Attachment fields are an all-or-none group (CHECK constraint). They
-- describe a single GIF/meme/sticker from the configured provider
-- (Klipy in v1) and are nullable until commit 15 wires the picker.

CREATE TABLE IF NOT EXISTS score_comments (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  score_id                UUID NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
  user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body                    TEXT NOT NULL,
  mentioned_user_ids      UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  attachment_provider     TEXT,
  attachment_kind         TEXT,
  attachment_id           TEXT,
  attachment_url          TEXT,
  attachment_preview_url  TEXT,
  attachment_width        INTEGER,
  attachment_height       INTEGER,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at              TIMESTAMPTZ,
  CONSTRAINT score_comments_attachment_all_or_none CHECK (
    (attachment_provider IS NULL AND attachment_id IS NULL AND attachment_url IS NULL)
    OR
    (attachment_provider IS NOT NULL AND attachment_id IS NOT NULL AND attachment_url IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS score_comments_score_idx
  ON score_comments (score_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS score_comments_user_idx
  ON score_comments (user_id)
  WHERE deleted_at IS NULL;

ALTER TABLE score_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "score_comments_select" ON score_comments FOR SELECT USING (
  deleted_at IS NULL AND score_id IN (
    SELECT s.id FROM scores s
    INNER JOIN workouts w ON s.workout_id = w.id
    WHERE w.created_by = auth.uid()
       OR w.community_id IN (
         SELECT community_id FROM community_memberships
         WHERE user_id = auth.uid() AND is_active = true
       )
  )
);

CREATE POLICY "score_comments_insert" ON score_comments FOR INSERT WITH CHECK (
  user_id = auth.uid()
);

CREATE POLICY "score_comments_update" ON score_comments FOR UPDATE USING (
  user_id = auth.uid()
);

CREATE POLICY "score_comments_delete" ON score_comments FOR DELETE USING (
  user_id = auth.uid()
);

-- ============================================
-- notifications
-- ============================================
--
-- Generic in-app notification table. Polymorphic target: exactly one of
-- score_id / comment_id / reaction_id is non-null per row. The denormalized
-- routing fields (workout_id, workout_part_id, community_id) cost three
-- uuids per row and save us three joins on every notification render.

CREATE TABLE IF NOT EXISTS notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL,
  score_id        UUID REFERENCES scores(id) ON DELETE CASCADE,
  comment_id      UUID REFERENCES score_comments(id) ON DELETE CASCADE,
  reaction_id     UUID REFERENCES score_reactions(id) ON DELETE CASCADE,
  workout_id      UUID REFERENCES workouts(id) ON DELETE CASCADE,
  workout_part_id UUID REFERENCES workout_parts(id) ON DELETE CASCADE,
  community_id    UUID REFERENCES communities(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_recipient_unread_idx
  ON notifications (recipient_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_recipient_all_idx
  ON notifications (recipient_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select" ON notifications FOR SELECT USING (
  recipient_id = auth.uid()
);

CREATE POLICY "notifications_update" ON notifications FOR UPDATE USING (
  recipient_id = auth.uid()
);

-- No INSERT policy: notifications are only written server-side via the
-- service-role key (Inngest fan-out). Same for DELETE — clients never
-- delete notification rows; mark-read flips read_at instead.

-- ============================================
-- notification_preferences
-- ============================================

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  in_app_enabled  BOOLEAN NOT NULL DEFAULT true,
  push_enabled    BOOLEAN NOT NULL DEFAULT true,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind)
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_preferences_select" ON notification_preferences FOR SELECT USING (
  user_id = auth.uid()
);

CREATE POLICY "notification_preferences_insert" ON notification_preferences FOR INSERT WITH CHECK (
  user_id = auth.uid()
);

CREATE POLICY "notification_preferences_update" ON notification_preferences FOR UPDATE USING (
  user_id = auth.uid()
);

CREATE POLICY "notification_preferences_delete" ON notification_preferences FOR DELETE USING (
  user_id = auth.uid()
);
