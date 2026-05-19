-- PR 3 §3.3 — Events admin UI.
--
-- `class_instances.kind='event'` already exists. PR 3 surfaces it via a
-- dedicated admin creator and renders events with a banner image on the
-- shared schedule view. These columns are nullable; regular classes
-- ignore them, events use them when provided.

alter table class_instances
  add column if not exists event_image_url   text,
  add column if not exists event_description text;
