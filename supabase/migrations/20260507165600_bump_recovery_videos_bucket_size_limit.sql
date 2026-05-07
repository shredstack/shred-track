-- Bump the recovery-videos bucket's file_size_limit to 500 MB so member-
-- uploaded demo videos (which can easily exceed 50 MB at iPhone 4K) don't
-- get rejected at the storage layer. The client-side cap in
-- src/lib/recovery/video-config.ts is also 500 MB; keeping these in sync
-- means the user-facing error message is the only gate.
--
-- Setting the limit on the bucket row overrides the global Supabase
-- file_size_limit (50 MiB locally; project-wide setting in production).
-- Idempotent: re-running just re-asserts the same value.

UPDATE storage.buckets
SET file_size_limit = 524288000  -- 500 * 1024 * 1024
WHERE id = 'recovery-videos';
