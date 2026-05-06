-- Recovery feature, Phase 1: mobility movement library + per-gym video customization.
--
-- Adds the canonical `recovery_movements` table (mirroring the validation
-- pattern from `movements`), a one-to-many `recovery_movement_videos` with
-- both upload and external-URL source types and per-row visibility, the
-- `recovery_movement_gym_overrides` table for gym-specific notes, and
-- routines (composite movements). Schedules + sessions land in later
-- phases.
--
-- Storage: a single bucket `recovery-videos` with public read off — every
-- playback URL is issued by our API as a short-lived signed URL. Public
-- visibility is enforced at the row level (see videos.visibility column),
-- not at the storage layer. Going single-bucket keeps the surface simple;
-- if we later want CDN-cached public videos without round-tripping through
-- the API, splitting can happen behind the existing API contract.

-- ---------------------------------------------------------------------------
-- recovery_movements
-- ---------------------------------------------------------------------------

CREATE TABLE recovery_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL,
  slug text NOT NULL,
  category text NOT NULL,                       -- 'stretch' | 'mobility' | 'strength' | 'breathwork' | 'soft_tissue' | 'other'
  body_region text[] NOT NULL DEFAULT '{}',
  description text,
  default_prescription jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_per_side boolean NOT NULL DEFAULT false,
  is_validated boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- System rows (created_by IS NULL) need a globally unique canonical name.
-- User rows are unique per (name, user) so two users can each create a row
-- with the same name without collision.
CREATE UNIQUE INDEX uq_recovery_movements_system_name
  ON recovery_movements (LOWER(canonical_name)) WHERE created_by IS NULL;
CREATE UNIQUE INDEX uq_recovery_movements_user_name
  ON recovery_movements (LOWER(canonical_name), created_by) WHERE created_by IS NOT NULL;

CREATE INDEX idx_recovery_movements_pending
  ON recovery_movements(created_at) WHERE is_validated = false;
CREATE INDEX idx_recovery_movements_body_region
  ON recovery_movements USING GIN (body_region);
CREATE INDEX idx_recovery_movements_category
  ON recovery_movements (category);

-- ---------------------------------------------------------------------------
-- recovery_movement_videos
-- ---------------------------------------------------------------------------

CREATE TABLE recovery_movement_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_id uuid NOT NULL REFERENCES recovery_movements(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('upload', 'external')),
  storage_path text,
  external_url text,
  external_provider text,                       -- 'youtube' | 'vimeo' | 'other'
  external_video_id text,
  visibility text NOT NULL CHECK (visibility IN ('public', 'gym')),
  community_id uuid REFERENCES communities(id) ON DELETE CASCADE,
  label text,
  duration_seconds int,
  poster_storage_path text,
  rights_confirmed boolean NOT NULL DEFAULT false,
  order_index int NOT NULL DEFAULT 0,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_recovery_video_source CHECK (
    (source_type = 'upload'   AND storage_path IS NOT NULL AND external_url IS NULL) OR
    (source_type = 'external' AND external_url IS NOT NULL AND storage_path IS NULL)
  ),
  CONSTRAINT chk_recovery_video_visibility CHECK (
    (visibility = 'public' AND community_id IS NULL) OR
    (visibility = 'gym'    AND community_id IS NOT NULL)
  )
);

CREATE INDEX idx_recovery_videos_movement
  ON recovery_movement_videos(movement_id, order_index);
CREATE INDEX idx_recovery_videos_community
  ON recovery_movement_videos(community_id) WHERE community_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- recovery_movement_gym_overrides
-- ---------------------------------------------------------------------------

CREATE TABLE recovery_movement_gym_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_id uuid NOT NULL REFERENCES recovery_movements(id) ON DELETE CASCADE,
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  notes_override text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (movement_id, community_id)
);

-- ---------------------------------------------------------------------------
-- recovery_routines
-- ---------------------------------------------------------------------------

CREATE TABLE recovery_routines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  is_validated boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  community_id uuid REFERENCES communities(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recovery_routine_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_id uuid NOT NULL REFERENCES recovery_routines(id) ON DELETE CASCADE,
  movement_id uuid NOT NULL REFERENCES recovery_movements(id) ON DELETE RESTRICT,
  order_index int NOT NULL,
  prescription jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text
);

CREATE INDEX idx_recovery_routine_movements
  ON recovery_routine_movements(routine_id, order_index);

CREATE INDEX idx_recovery_routines_community ON recovery_routines(community_id);
CREATE INDEX idx_recovery_routines_creator ON recovery_routines(created_by);

-- ---------------------------------------------------------------------------
-- Storage bucket: recovery-videos
-- ---------------------------------------------------------------------------
--
-- Public read OFF. Every video play uses a signed URL issued by our API,
-- which checks the row-level visibility (public vs. gym) before signing.
-- This keeps the visibility model simple — bucket-level access doesn't
-- have to mirror per-row visibility because nothing reads the bucket
-- directly. We could later split into two buckets (public-cached vs.
-- private signed) without touching application code.

INSERT INTO storage.buckets (id, name, public)
VALUES ('recovery-videos', 'recovery-videos', false)
ON CONFLICT (id) DO NOTHING;

-- Block anonymous access to storage objects in this bucket. Authenticated
-- access also has to go through the API (which uses the service role for
-- signed-URL issuance) — we deliberately don't grant SELECT to the
-- authenticated role so a leaked client token can't enumerate or download
-- arbitrary objects.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY';
EXCEPTION WHEN insufficient_privilege THEN
  -- RLS already enabled in managed Supabase; ignore.
  NULL;
END$$;
