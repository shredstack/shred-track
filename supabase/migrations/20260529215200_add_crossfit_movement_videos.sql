-- CrossFit movement videos: in-app embeddable videos for the `movements`
-- library. Mirrors recovery_movement_videos so super admins / gym
-- coach+admins can publish public demos and any member can attach a
-- private or gym-scoped video.
--
-- The legacy `movements.video_url` column is left in place: the detail page
-- treats it as a fallback embed when no new-table videos exist. Admins can
-- migrate them by attaching the same URL as an 'external' video here.
--
-- Storage: separate `crossfit-videos` bucket so the lifecycle (size limit,
-- future RLS adjustments, optional CDN split) can move independently of
-- recovery. Public read off — playback URLs are signed by our API.

CREATE TABLE crossfit_movement_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_id uuid NOT NULL REFERENCES movements(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('upload', 'external')),
  storage_path text,
  external_url text,
  external_provider text,
  external_video_id text,
  visibility text NOT NULL CHECK (visibility IN ('public', 'gym', 'private')),
  community_id uuid REFERENCES communities(id) ON DELETE CASCADE,
  label text,
  duration_seconds int,
  poster_storage_path text,
  rights_confirmed boolean NOT NULL DEFAULT false,
  order_index int NOT NULL DEFAULT 0,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_crossfit_video_source CHECK (
    (source_type = 'upload'   AND storage_path IS NOT NULL AND external_url IS NULL) OR
    (source_type = 'external' AND external_url IS NOT NULL AND storage_path IS NULL)
  ),
  CONSTRAINT chk_crossfit_video_visibility CHECK (
    (visibility = 'public'  AND community_id IS NULL)     OR
    (visibility = 'gym'     AND community_id IS NOT NULL) OR
    (visibility = 'private' AND community_id IS NULL)
  )
);

CREATE INDEX idx_crossfit_videos_movement
  ON crossfit_movement_videos(movement_id, order_index);
CREATE INDEX idx_crossfit_videos_community
  ON crossfit_movement_videos(community_id) WHERE community_id IS NOT NULL;

-- Storage bucket. 500 MB to match the client cap in video-config.ts so the
-- only user-facing rejection comes from the app, not the storage layer.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('crossfit-videos', 'crossfit-videos', false, 524288000)
ON CONFLICT (id) DO UPDATE SET file_size_limit = EXCLUDED.file_size_limit;
