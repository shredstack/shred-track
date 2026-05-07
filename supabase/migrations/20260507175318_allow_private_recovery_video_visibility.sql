-- Allow visibility = 'private' on recovery_movement_videos.
--
-- The original migration (20260505220000_recovery_phase1_movements.sql) only
-- permitted 'public' and 'gym'. The app's POST /api/recovery/movements/[id]/videos
-- route, the storage path builder, the GET filter, and the Drizzle schema all
-- treat 'private' as a valid per-uploader visibility — but inserts hit the
-- two CHECK constraints below and fail. Update both to permit 'private' with
-- community_id IS NULL.

ALTER TABLE recovery_movement_videos
  DROP CONSTRAINT recovery_movement_videos_visibility_check;

ALTER TABLE recovery_movement_videos
  ADD CONSTRAINT recovery_movement_videos_visibility_check
  CHECK (visibility IN ('public', 'gym', 'private'));

ALTER TABLE recovery_movement_videos
  DROP CONSTRAINT chk_recovery_video_visibility;

ALTER TABLE recovery_movement_videos
  ADD CONSTRAINT chk_recovery_video_visibility CHECK (
    (visibility = 'public'  AND community_id IS NULL)     OR
    (visibility = 'gym'     AND community_id IS NOT NULL) OR
    (visibility = 'private' AND community_id IS NULL)
  );
