-- Add gym visibility to HYROX race templates.
--
-- community_id (nullable) — when set, the template is shared with that gym.
-- When null, the template is private to its owner (the existing behavior).
--
-- cloned_from_id (nullable, ON DELETE SET NULL) — when a user clones a
-- gym member's shared template, the new row records the source for
-- attribution. SET NULL so clones survive deletion of the original.

ALTER TABLE hyrox_race_templates
  ADD COLUMN community_id uuid REFERENCES communities(id) ON DELETE SET NULL,
  ADD COLUMN cloned_from_id uuid REFERENCES hyrox_race_templates(id) ON DELETE SET NULL;

-- Listing a gym's shared templates filters by (community_id, created_at desc).
CREATE INDEX race_templates_community
  ON hyrox_race_templates (community_id, created_at DESC)
  WHERE community_id IS NOT NULL;
