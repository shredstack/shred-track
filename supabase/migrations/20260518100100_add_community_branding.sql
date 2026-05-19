-- Per-gym branding (CFD readiness spec §1.2 / brainstorm Option B).
--
-- These columns let a gym customize the look of the app for its members
-- without us shipping a separate App Store binary per gym. The active gym's
-- primary_color drives the in-app theme; logo_url drives the header.
--
-- gym_timezone is bundled here because every gym-local scheduled job needs
-- it (notifications at 6am gym time, end-of-month rollups, etc.). Default
-- is America/Denver because CFD is in Draper, UT (MDT).

ALTER TABLE communities
  ADD COLUMN IF NOT EXISTS logo_url          text,
  ADD COLUMN IF NOT EXISTS primary_color     text,
  ADD COLUMN IF NOT EXISTS brand_assets      jsonb,
  ADD COLUMN IF NOT EXISTS website_url       text,
  ADD COLUMN IF NOT EXISTS invite_url_slug   text,
  ADD COLUMN IF NOT EXISTS auto_join_via_link boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gym_timezone      text NOT NULL DEFAULT 'America/Denver';

-- Slugs are user-facing in URLs (/g/<slug>); enforce uniqueness so two gyms
-- can't fight over the same path. Partial index so null slugs don't
-- collide.
CREATE UNIQUE INDEX IF NOT EXISTS communities_invite_url_slug_unique
  ON communities (invite_url_slug)
  WHERE invite_url_slug IS NOT NULL;
