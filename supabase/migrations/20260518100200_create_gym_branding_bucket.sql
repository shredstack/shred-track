-- Storage bucket for per-gym branding assets (logos, hero images, etc.).
--
-- Public read is ON for the same reason avatars are public: the gym logo
-- is shown directly in the app header for every member of the gym, and we
-- want CDN caching without signed URLs. Uploads go through the service
-- role only.
--
-- File size cap is higher than avatars (10 MB) because brand assets can
-- include hero backgrounds in addition to the small header logo. The
-- upload helper crops/compresses before send.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'gym-branding',
  'gym-branding',
  true,
  10485760, -- 10 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
