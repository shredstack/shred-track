-- ---------------------------------------------------------------------------
-- Expand Adaptive divisions from 2 → 26 (13 subdivisions × 2 genders)
-- Update Youngstars labels from Women/Men → Girls/Boys
-- ---------------------------------------------------------------------------

BEGIN;

-- =========================================================================
-- 1. Update Youngstars labels to Girls/Boys
-- =========================================================================
UPDATE hyrox_divisions SET gender_label = 'Girls Youngstars 8-9'   WHERE division_key = 'youngstars_8_9_women';
UPDATE hyrox_divisions SET gender_label = 'Boys Youngstars 8-9'    WHERE division_key = 'youngstars_8_9_men';
UPDATE hyrox_divisions SET gender_label = 'Girls Youngstars 10-11' WHERE division_key = 'youngstars_10_11_women';
UPDATE hyrox_divisions SET gender_label = 'Boys Youngstars 10-11'  WHERE division_key = 'youngstars_10_11_men';
UPDATE hyrox_divisions SET gender_label = 'Girls Youngstars 12-13' WHERE division_key = 'youngstars_12_13_women';
UPDATE hyrox_divisions SET gender_label = 'Boys Youngstars 12-13'  WHERE division_key = 'youngstars_12_13_men';
UPDATE hyrox_divisions SET gender_label = 'Girls Youngstars 14-15' WHERE division_key = 'youngstars_14_15_women';
UPDATE hyrox_divisions SET gender_label = 'Boys Youngstars 14-15'  WHERE division_key = 'youngstars_14_15_men';

-- =========================================================================
-- 2. Remove old combined adaptive divisions
-- =========================================================================
-- Delete station specs referencing old adaptive divisions
DELETE FROM hyrox_division_stations
WHERE division_id IN (
  SELECT id FROM hyrox_divisions WHERE division_key IN ('adaptive_women', 'adaptive_men')
);

-- Delete any reference times for old adaptive divisions
DELETE FROM hyrox_station_reference_times
WHERE division_id IN (
  SELECT id FROM hyrox_divisions WHERE division_key IN ('adaptive_women', 'adaptive_men')
);

-- Update any user profiles referencing old keys → map to closest new key
UPDATE hyrox_profiles
SET target_division = CASE
  WHEN target_division = 'adaptive_women' THEN 'adaptive_ll_minor_women'
  WHEN target_division = 'adaptive_men'   THEN 'adaptive_ll_minor_men'
  ELSE target_division
END
WHERE target_division IN ('adaptive_women', 'adaptive_men');

-- Delete old division rows
DELETE FROM hyrox_divisions WHERE division_key IN ('adaptive_women', 'adaptive_men');

-- =========================================================================
-- 3. Insert 26 new adaptive subdivision divisions
-- =========================================================================
INSERT INTO hyrox_divisions (division_key, category, gender_label, display_order) VALUES
  -- Lower Limb
  ('adaptive_ll_minor_women',       'adaptive', 'Women Adaptive — Lower Limb Minor',      40),
  ('adaptive_ll_minor_men',         'adaptive', 'Men Adaptive — Lower Limb Minor',        41),
  ('adaptive_ll_major_women',       'adaptive', 'Women Adaptive — Lower Limb Major',      42),
  ('adaptive_ll_major_men',         'adaptive', 'Men Adaptive — Lower Limb Major',        43),
  -- Upper Limb
  ('adaptive_ul_minor_women',       'adaptive', 'Women Adaptive — Upper Limb Minor',      44),
  ('adaptive_ul_minor_men',         'adaptive', 'Men Adaptive — Upper Limb Minor',        45),
  ('adaptive_ul_major_women',       'adaptive', 'Women Adaptive — Upper Limb Major',      46),
  ('adaptive_ul_major_men',         'adaptive', 'Men Adaptive — Upper Limb Major',        47),
  -- Short Stature
  ('adaptive_short_stature_women',  'adaptive', 'Women Adaptive — Short Stature',         48),
  ('adaptive_short_stature_men',    'adaptive', 'Men Adaptive — Short Stature',           49),
  -- Visual Impairment
  ('adaptive_visual_women',         'adaptive', 'Women Adaptive — Visual Impairment',     50),
  ('adaptive_visual_men',           'adaptive', 'Men Adaptive — Visual Impairment',       51),
  -- Deaf / Hard of Hearing
  ('adaptive_deaf_women',           'adaptive', 'Women Adaptive — Deaf / Hard of Hearing', 52),
  ('adaptive_deaf_men',             'adaptive', 'Men Adaptive — Deaf / Hard of Hearing',   53),
  -- Neurological
  ('adaptive_neuro_minor_women',    'adaptive', 'Women Adaptive — Neuro Minor',           54),
  ('adaptive_neuro_minor_men',      'adaptive', 'Men Adaptive — Neuro Minor',             55),
  ('adaptive_neuro_moderate_women', 'adaptive', 'Women Adaptive — Neuro Moderate',        56),
  ('adaptive_neuro_moderate_men',   'adaptive', 'Men Adaptive — Neuro Moderate',          57),
  ('adaptive_neuro_major_women',    'adaptive', 'Women Adaptive — Neuro Major',           58),
  ('adaptive_neuro_major_men',      'adaptive', 'Men Adaptive — Neuro Major',             59),
  -- Seated
  ('adaptive_swhf_women',           'adaptive', 'Women Adaptive — Seated (SWHF)',         60),
  ('adaptive_swhf_men',             'adaptive', 'Men Adaptive — Seated (SWHF)',           61),
  ('adaptive_swohf_women',          'adaptive', 'Women Adaptive — Seated (SWOHF)',        62),
  ('adaptive_swohf_men',            'adaptive', 'Men Adaptive — Seated (SWOHF)',          63),
  ('adaptive_swoc_women',           'adaptive', 'Women Adaptive — Seated (SWOC)',         64),
  ('adaptive_swoc_men',             'adaptive', 'Men Adaptive — Seated (SWOC)',           65)
ON CONFLICT (division_key) DO NOTHING;

-- =========================================================================
-- 4. Bump Youngstars display_order to avoid collisions with new adaptive rows
-- =========================================================================
UPDATE hyrox_divisions SET display_order = 70 WHERE division_key = 'youngstars_8_9_women';
UPDATE hyrox_divisions SET display_order = 71 WHERE division_key = 'youngstars_8_9_men';
UPDATE hyrox_divisions SET display_order = 72 WHERE division_key = 'youngstars_10_11_women';
UPDATE hyrox_divisions SET display_order = 73 WHERE division_key = 'youngstars_10_11_men';
UPDATE hyrox_divisions SET display_order = 74 WHERE division_key = 'youngstars_12_13_women';
UPDATE hyrox_divisions SET display_order = 75 WHERE division_key = 'youngstars_12_13_men';
UPDATE hyrox_divisions SET display_order = 76 WHERE division_key = 'youngstars_14_15_women';
UPDATE hyrox_divisions SET display_order = 77 WHERE division_key = 'youngstars_14_15_men';

COMMIT;
