-- workout_published notifications collapse to one per (release × recipient)
-- instead of one per (workout × recipient). The new column lets the inbox
-- render "Programming dropped — week of <Monday>" from the release row.
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS programming_release_id uuid
    REFERENCES programming_releases(id) ON DELETE CASCADE;

-- Block duplicate workout_published rows on republish / retry. Partial
-- unique so other kinds (which leave programming_release_id NULL) aren't
-- constrained.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_release_recipient_unique
  ON notifications(recipient_id, programming_release_id)
  WHERE kind = 'workout_published' AND programming_release_id IS NOT NULL;
