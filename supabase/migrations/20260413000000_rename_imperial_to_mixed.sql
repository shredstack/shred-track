-- Rename 'imperial' unit preference to 'mixed' (Lbs/M)
-- No more pure imperial (feet) — HYROX distances are always in meters

ALTER TABLE users ALTER COLUMN unit_preference SET DEFAULT 'mixed';

UPDATE users SET unit_preference = 'mixed' WHERE unit_preference = 'imperial';
