-- Gym social feed (spec §2.3).
--
-- Gym-scoped social: announcements, whiteboard photos linked to a workout,
-- auto-anniversary/birthday posts. Reactions + comments mirror the score
-- social tables; the comment-list UI is extracted into a shared component
-- so both surfaces use the same composer + reaction bar.

CREATE TABLE IF NOT EXISTS gym_posts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id        uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  author_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN (
                        'announcement','whiteboard','auto_anniversary',
                        'auto_birthday','meme','pinned'
                      )),
  status              text NOT NULL CHECK (status IN ('draft','pending_review','published','deleted')) DEFAULT 'published',
  body                text,
  -- For kind='whiteboard': the workout this photo documents.
  workout_id          uuid REFERENCES workouts(id),
  workout_date        date,
  mentioned_user_ids  uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  is_pinned           boolean NOT NULL DEFAULT false,
  published_at        timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gym_posts_community_published
  ON gym_posts(community_id, published_at DESC)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS gym_posts_workout_idx
  ON gym_posts(workout_id) WHERE workout_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gym_posts_pending_review_idx
  ON gym_posts(community_id, created_at DESC)
  WHERE status = 'pending_review';

CREATE TABLE IF NOT EXISTS gym_post_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       uuid NOT NULL REFERENCES gym_posts(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('image','gif','video')),
  url           text NOT NULL,
  thumbnail_url text,
  width         int,
  height        int,
  position      int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gym_post_attachments_post_idx
  ON gym_post_attachments(post_id, position);

CREATE TABLE IF NOT EXISTS gym_post_reactions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    uuid NOT NULL REFERENCES gym_posts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction   text NOT NULL DEFAULT 'fire',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id, reaction)
);

CREATE INDEX IF NOT EXISTS gym_post_reactions_post_idx
  ON gym_post_reactions(post_id);

CREATE TABLE IF NOT EXISTS gym_post_comments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id            uuid NOT NULL REFERENCES gym_posts(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body               text NOT NULL,
  mentioned_user_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  deleted_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gym_post_comments_post_idx
  ON gym_post_comments(post_id, created_at)
  WHERE deleted_at IS NULL;

-- Anniversary/birthday auto-post source: each membership gets an
-- anniversary date (defaults to joined_at) so the daily Inngest job can
-- find today's anniversaries cheaply.
ALTER TABLE community_memberships
  ADD COLUMN IF NOT EXISTS gym_anniversary_date date;

UPDATE community_memberships
  SET gym_anniversary_date = joined_at::date
  WHERE gym_anniversary_date IS NULL;

CREATE INDEX IF NOT EXISTS community_memberships_anniversary_idx
  ON community_memberships(gym_anniversary_date)
  WHERE gym_anniversary_date IS NOT NULL;

-- Notification kind extensions (PR 2 §2.6). Drop and re-add the check
-- constraint with the new kinds so the dispatcher can insert them.
-- The original constraint was implicit (no explicit name) — find via the
-- notification table's check definition.
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_kind_check;
-- No explicit CHECK was added in the social migration, so the table
-- accepts any kind. We add an explicit allowlist now so unknown kinds
-- fail fast at the DB layer.
ALTER TABLE notifications
  ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
    'score_reaction',
    'score_comment',
    'score_mention',
    'workout_published',
    'social_post_published',
    'social_post_reaction',
    'social_post_comment',
    'social_post_mention',
    'committed_club_progress',
    'committed_club_earned',
    'committed_club_streak',
    'class_cancelled',
    'class_reservation_reminder'
  ));

-- Polymorphic targets for non-score notifications.
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS gym_post_id uuid REFERENCES gym_posts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS gym_post_comment_id uuid REFERENCES gym_post_comments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS class_instance_id uuid REFERENCES class_instances(id) ON DELETE CASCADE;

-- Storage bucket for gym social attachments (whiteboard photos, memes).
-- Public read so the in-app feed renders without signed URLs.
INSERT INTO storage.buckets (id, name, public)
  VALUES ('gym-social', 'gym-social', true)
  ON CONFLICT (id) DO NOTHING;

-- Gym admins/coaches can upload; anyone authenticated can read.
DROP POLICY IF EXISTS "gym social public read" ON storage.objects;
CREATE POLICY "gym social public read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'gym-social');

DROP POLICY IF EXISTS "gym social authenticated write" ON storage.objects;
CREATE POLICY "gym social authenticated write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'gym-social');
