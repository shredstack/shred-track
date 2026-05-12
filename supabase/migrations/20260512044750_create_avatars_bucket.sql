-- Avatars bucket for user profile pictures.
--
-- Public read is ON: the resulting object URL is embedded directly in
-- <img>/<AvatarImage> across the app, so we need anon GET to work without
-- signed URLs. There's nothing sensitive here — these are profile photos
-- a user chooses to display publicly inside the product.
--
-- Writes still go through the service role via signed upload URLs issued
-- by /api/user/profile/avatar (same pattern as recovery-videos), so the
-- bucket's public flag does not imply public writes.
--
-- File size cap: 5 MB. The client crops + compresses to a ~512×512 JPEG
-- (typically 30–80 KB), so 5 MB is generous head-room that still rejects
-- anyone bypassing the client compression.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  5242880, -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
