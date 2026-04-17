-- Clean up anomalous split times in hyrox_public_splits.
--
-- Thresholds based on physical limits:
--   SkiErg 1000m:  world record ~2:36, floor at 2:20 (140s)
--   Rowing 1000m:  world record ~2:35, floor at 2:20 (140s)
--   Sled Push:     floor 30s  (lightest weight, fast surface)
--   Sled Pull:     floor 60s
--   Burpee Broad Jumps 80m: floor 60s
--   Farmers Carry 200m:     floor 30s
--   Sandbag Lunges 100m:    floor 60s
--   Wall Balls 75-100 reps: floor 120s
--   1km Run:       floor 120s (no one runs sub-2:00 mid-HYROX)
--   Roxzone total: floor 120s
--
--   Max per station: 1200s (20 min) — anything longer is bad data
--   Max per run:      900s (15 min)
--   Max roxzone:     1800s (30 min)
--
-- This script DELETES the bad rows so they don't pollute aggregates.
-- Run against your local Supabase DB. Safe to re-run (idempotent).

BEGIN;

-- Station minimums
DELETE FROM hyrox_public_splits
WHERE segment_type = 'station' AND (
  (station_name = 'SkiErg'              AND time_seconds < 140)
  OR (station_name = 'Rowing'           AND time_seconds < 140)
  OR (station_name = 'Sled Push'        AND time_seconds < 30)
  OR (station_name = 'Sled Pull'        AND time_seconds < 60)
  OR (station_name = 'Burpee Broad Jumps' AND time_seconds < 60)
  OR (station_name = 'Farmers Carry'    AND time_seconds < 30)
  OR (station_name = 'Sandbag Lunges'   AND time_seconds < 60)
  OR (station_name = 'Wall Balls'       AND time_seconds < 120)
);

-- Station maximums (anything over 20 min is bad data)
DELETE FROM hyrox_public_splits
WHERE segment_type = 'station' AND time_seconds > 1200;

-- Run minimums (sub-2:00 per km is not realistic mid-race)
DELETE FROM hyrox_public_splits
WHERE segment_type = 'run' AND time_seconds < 120;

-- Run maximums (over 15 min per km is bad data)
DELETE FROM hyrox_public_splits
WHERE segment_type = 'run' AND time_seconds > 900;

-- Roxzone bounds
DELETE FROM hyrox_public_splits
WHERE segment_type = 'roxzone' AND (time_seconds < 120 OR time_seconds > 1800);

COMMIT;

-- Verify: count remaining rows by type
SELECT segment_type, COUNT(*) as remaining_rows
FROM hyrox_public_splits
GROUP BY segment_type
ORDER BY segment_type;
