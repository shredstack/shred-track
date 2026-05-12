-- The workouts builder UI has never exposed a publish/draft toggle, so every
-- gym workout created up to this point sits at published=false. The watch
-- endpoint (/api/crossfit/wod/today) filters on published=true, which is
-- why coaches' programmed WODs never reach athletes' watches.
--
-- Going forward the POST /api/workouts handler defaults gym workouts to
-- published=true (personal workouts stay false — the flag is meaningless
-- there). This migration flips existing gym workouts so they match the new
-- default and start showing up on the watch.

UPDATE workouts
SET published = true
WHERE community_id IS NOT NULL
  AND published = false;
