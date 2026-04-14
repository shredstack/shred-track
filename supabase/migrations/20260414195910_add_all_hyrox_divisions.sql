-- Add all HYROX divisions (Elite, Doubles, Relay, Corporate, Adaptive, Youngstars)
-- and their station specifications.
--
-- Existing 4 divisions (women_open, women_pro, men_open, men_pro) are untouched.
-- New divisions use display_order 10+ to sort after them.

-- ============================================
-- New division rows
-- ============================================

INSERT INTO hyrox_divisions (division_key, category, gender_label, display_order) VALUES
  -- Elite 15 (same weights as Pro)
  ('elite_15_women',            'elite',           'Women Elite 15',              10),
  ('elite_15_men',              'elite',           'Men Elite 15',                11),
  -- Doubles Open
  ('doubles_women_open',        'double',          'Women Doubles Open',          20),
  ('doubles_men_open',          'double',          'Men Doubles Open',            21),
  ('doubles_mixed_open',        'double',          'Mixed Doubles Open',          22),
  -- Doubles Pro
  ('doubles_women_pro',         'double',          'Women Doubles Pro',           23),
  ('doubles_men_pro',           'double',          'Men Doubles Pro',             24),
  ('doubles_mixed_pro',         'double',          'Mixed Doubles Pro',           25),
  -- Elite 15 Doubles
  ('elite_15_doubles_women',    'elite',           'Women Elite 15 Doubles',      26),
  ('elite_15_doubles_men',      'elite',           'Men Elite 15 Doubles',        27),
  ('elite_15_doubles_mixed',    'elite',           'Mixed Elite 15 Doubles',      28),
  -- Team Relay
  ('relay_women',               'relay',           'Women Relay',                 30),
  ('relay_men',                 'relay',           'Men Relay',                   31),
  ('relay_mixed',               'relay',           'Mixed Relay',                 32),
  -- Corporate Relay
  ('corporate_relay_women',     'corporate_relay', 'Women Corporate Relay',       33),
  ('corporate_relay_men',       'corporate_relay', 'Men Corporate Relay',         34),
  ('corporate_relay_mixed',     'corporate_relay', 'Mixed Corporate Relay',       35),
  -- Company Challenge (same as corporate relay)
  ('company_challenge_women',   'corporate_relay', 'Women Company Challenge',     36),
  ('company_challenge_men',     'corporate_relay', 'Men Company Challenge',       37),
  ('company_challenge_mixed',   'corporate_relay', 'Mixed Company Challenge',     38),
  -- Adaptive
  ('adaptive_women',            'adaptive',        'Women Adaptive',              40),
  ('adaptive_men',              'adaptive',        'Men Adaptive',                41),
  -- Youngstars
  ('youngstars_8_9_women',      'youngstars',      'Women Youngstars 8-9',        50),
  ('youngstars_8_9_men',        'youngstars',      'Men Youngstars 8-9',          51),
  ('youngstars_10_11_women',    'youngstars',      'Women Youngstars 10-11',      52),
  ('youngstars_10_11_men',      'youngstars',      'Men Youngstars 10-11',        53),
  ('youngstars_12_13_women',    'youngstars',      'Women Youngstars 12-13',      54),
  ('youngstars_12_13_men',      'youngstars',      'Men Youngstars 12-13',        55),
  ('youngstars_14_15_women',    'youngstars',      'Women Youngstars 14-15',      56),
  ('youngstars_14_15_men',      'youngstars',      'Men Youngstars 14-15',        57)
ON CONFLICT (division_key) DO NOTHING;


-- ============================================
-- Station specs for new divisions
-- ============================================

DO $$
DECLARE
  div_id uuid;
BEGIN

  -- -------------------------------------------------------
  -- Elite 15 Women (same weights as Women Pro)
  -- -------------------------------------------------------
  SELECT id INTO div_id FROM hyrox_divisions WHERE division_key = 'elite_15_women';
  IF div_id IS NOT NULL THEN
    INSERT INTO hyrox_division_stations (division_id, station, distance_meters, reps, weight_kg, weight_note) VALUES
      (div_id, 'SkiErg',              1000, NULL, NULL,  NULL),
      (div_id, 'Sled Push',           50,   NULL, 152,   '152 kg'),
      (div_id, 'Sled Pull',           50,   NULL, 103,   '103 kg'),
      (div_id, 'Broad Jump Burpees',  80,   NULL, NULL,  NULL),
      (div_id, 'Rowing',              1000, NULL, NULL,  NULL),
      (div_id, 'Farmers Carry',       200,  NULL, 48,    '2x24 kg'),
      (div_id, 'Sandbag Lunges',      100,  NULL, 20,    '20 kg'),
      (div_id, 'Wall Balls',          NULL, 100,  6,     '6 kg')
    ON CONFLICT (division_id, station) DO NOTHING;
  END IF;

  -- -------------------------------------------------------
  -- Elite 15 Men (same weights as Men Pro)
  -- -------------------------------------------------------
  SELECT id INTO div_id FROM hyrox_divisions WHERE division_key = 'elite_15_men';
  IF div_id IS NOT NULL THEN
    INSERT INTO hyrox_division_stations (division_id, station, distance_meters, reps, weight_kg, weight_note) VALUES
      (div_id, 'SkiErg',              1000, NULL, NULL,  NULL),
      (div_id, 'Sled Push',           50,   NULL, 202,   '202 kg'),
      (div_id, 'Sled Pull',           50,   NULL, 153,   '153 kg'),
      (div_id, 'Broad Jump Burpees',  80,   NULL, NULL,  NULL),
      (div_id, 'Rowing',              1000, NULL, NULL,  NULL),
      (div_id, 'Farmers Carry',       200,  NULL, 64,    '2x32 kg'),
      (div_id, 'Sandbag Lunges',      100,  NULL, 30,    '30 kg'),
      (div_id, 'Wall Balls',          NULL, 100,  9,     '9 kg')
    ON CONFLICT (division_id, station) DO NOTHING;
  END IF;

  -- -------------------------------------------------------
  -- Doubles Women Open (Open women weights)
  -- -------------------------------------------------------
  SELECT id INTO div_id FROM hyrox_divisions WHERE division_key = 'doubles_women_open';
  IF div_id IS NOT NULL THEN
    INSERT INTO hyrox_division_stations (division_id, station, distance_meters, reps, weight_kg, weight_note) VALUES
      (div_id, 'SkiErg',              1000, NULL, NULL,  NULL),
      (div_id, 'Sled Push',           50,   NULL, 102,   '102 kg'),
      (div_id, 'Sled Pull',           50,   NULL, 78,    '78 kg'),
      (div_id, 'Broad Jump Burpees',  80,   NULL, NULL,  NULL),
      (div_id, 'Rowing',              1000, NULL, NULL,  NULL),
      (div_id, 'Farmers Carry',       200,  NULL, 32,    '2x16 kg'),
      (div_id, 'Sandbag Lunges',      100,  NULL, 10,    '10 kg'),
      (div_id, 'Wall Balls',          NULL, 100,  4,     '4 kg')
    ON CONFLICT (division_id, station) DO NOTHING;
  END IF;

  -- -------------------------------------------------------
  -- Doubles Men Open (Open men weights)
  -- -------------------------------------------------------
  SELECT id INTO div_id FROM hyrox_divisions WHERE division_key = 'doubles_men_open';
  IF div_id IS NOT NULL THEN
    INSERT INTO hyrox_division_stations (division_id, station, distance_meters, reps, weight_kg, weight_note) VALUES
      (div_id, 'SkiErg',              1000, NULL, NULL,  NULL),
      (div_id, 'Sled Push',           50,   NULL, 152,   '152 kg'),
      (div_id, 'Sled Pull',           50,   NULL, 103,   '103 kg'),
      (div_id, 'Broad Jump Burpees',  80,   NULL, NULL,  NULL),
      (div_id, 'Rowing',              1000, NULL, NULL,  NULL),
      (div_id, 'Farmers Carry',       200,  NULL, 48,    '2x24 kg'),
      (div_id, 'Sandbag Lunges',      100,  NULL, 20,    '20 kg'),
      (div_id, 'Wall Balls',          NULL, 100,  6,     '6 kg')
    ON CONFLICT (division_id, station) DO NOTHING;
  END IF;

  -- -------------------------------------------------------
  -- Doubles Mixed Open (Open men weights)
  -- -------------------------------------------------------
  SELECT id INTO div_id FROM hyrox_divisions WHERE division_key = 'doubles_mixed_open';
  IF div_id IS NOT NULL THEN
    INSERT INTO hyrox_division_stations (division_id, station, distance_meters, reps, weight_kg, weight_note) VALUES
      (div_id, 'SkiErg',              1000, NULL, NULL,  NULL),
      (div_id, 'Sled Push',           50,   NULL, 152,   '152 kg'),
      (div_id, 'Sled Pull',           50,   NULL, 103,   '103 kg'),
      (div_id, 'Broad Jump Burpees',  80,   NULL, NULL,  NULL),
      (div_id, 'Rowing',              1000, NULL, NULL,  NULL),
      (div_id, 'Farmers Carry',       200,  NULL, 48,    '2x24 kg'),
      (div_id, 'Sandbag Lunges',      100,  NULL, 20,    '20 kg'),
      (div_id, 'Wall Balls',          NULL, 100,  6,     '6 kg')
    ON CONFLICT (division_id, station) DO NOTHING;
  END IF;

  -- -------------------------------------------------------
  -- Doubles Women Pro (Pro women weights)
  -- -------------------------------------------------------
  SELECT id INTO div_id FROM hyrox_divisions WHERE division_key = 'doubles_women_pro';
  IF div_id IS NOT NULL THEN
    INSERT INTO hyrox_division_stations (division_id, station, distance_meters, reps, weight_kg, weight_note) VALUES
      (div_id, 'SkiErg',              1000, NULL, NULL,  NULL),
      (div_id, 'Sled Push',           50,   NULL, 152,   '152 kg'),
      (div_id, 'Sled Pull',           50,   NULL, 103,   '103 kg'),
      (div_id, 'Broad Jump Burpees',  80,   NULL, NULL,  NULL),
      (div_id, 'Rowing',              1000, NULL, NULL,  NULL),
      (div_id, 'Farmers Carry',       200,  NULL, 48,    '2x24 kg'),
      (div_id, 'Sandbag Lunges',      100,  NULL, 20,    '20 kg'),
      (div_id, 'Wall Balls',          NULL, 100,  6,     '6 kg')
    ON CONFLICT (division_id, station) DO NOTHING;
  END IF;

  -- -------------------------------------------------------
  -- Doubles Men Pro (Pro men weights)
  -- -------------------------------------------------------
  SELECT id INTO div_id FROM hyrox_divisions WHERE division_key = 'doubles_men_pro';
  IF div_id IS NOT NULL THEN
    INSERT INTO hyrox_division_stations (division_id, station, distance_meters, reps, weight_kg, weight_note) VALUES
      (div_id, 'SkiErg',              1000, NULL, NULL,  NULL),
      (div_id, 'Sled Push',           50,   NULL, 202,   '202 kg'),
      (div_id, 'Sled Pull',           50,   NULL, 153,   '153 kg'),
      (div_id, 'Broad Jump Burpees',  80,   NULL, NULL,  NULL),
      (div_id, 'Rowing',              1000, NULL, NULL,  NULL),
      (div_id, 'Farmers Carry',       200,  NULL, 64,    '2x32 kg'),
      (div_id, 'Sandbag Lunges',      100,  NULL, 30,    '30 kg'),
      (div_id, 'Wall Balls',          NULL, 100,  9,     '9 kg')
    ON CONFLICT (division_id, station) DO NOTHING;
  END IF;

  -- -------------------------------------------------------
  -- Doubles Mixed Pro (Pro men weights)
  -- -------------------------------------------------------
  SELECT id INTO div_id FROM hyrox_divisions WHERE division_key = 'doubles_mixed_pro';
  IF div_id IS NOT NULL THEN
    INSERT INTO hyrox_division_stations (division_id, station, distance_meters, reps, weight_kg, weight_note) VALUES
      (div_id, 'SkiErg',              1000, NULL, NULL,  NULL),
      (div_id, 'Sled Push',           50,   NULL, 202,   '202 kg'),
      (div_id, 'Sled Pull',           50,   NULL, 153,   '153 kg'),
      (div_id, 'Broad Jump Burpees',  80,   NULL, NULL,  NULL),
      (div_id, 'Rowing',              1000, NULL, NULL,  NULL),
      (div_id, 'Farmers Carry',       200,  NULL, 64,    '2x32 kg'),
      (div_id, 'Sandbag Lunges',      100,  NULL, 30,    '30 kg'),
      (div_id, 'Wall Balls',          NULL, 100,  9,     '9 kg')
    ON CONFLICT (division_id, station) DO NOTHING;
  END IF;

  -- -------------------------------------------------------
  -- Elite 15 Doubles Women (Pro women weights)
  -- -------------------------------------------------------
  SELECT id INTO div_id FROM hyrox_divisions WHERE division_key = 'elite_15_doubles_women';
  IF div_id IS NOT NULL THEN
    INSERT INTO hyrox_division_stations (division_id, station, distance_meters, reps, weight_kg, weight_note) VALUES
      (div_id, 'SkiErg',              1000, NULL, NULL,  NULL),
      (div_id, 'Sled Push',           50,   NULL, 152,   '152 kg'),
      (div_id, 'Sled Pull',           50,   NULL, 103,   '103 kg'),
      (div_id, 'Broad Jump Burpees',  80,   NULL, NULL,  NULL),
      (div_id, 'Rowing',              1000, NULL, NULL,  NULL),
      (div_id, 'Farmers Carry',       200,  NULL, 48,    '2x24 kg'),
      (div_id, 'Sandbag Lunges',      100,  NULL, 20,    '20 kg'),
      (div_id, 'Wall Balls',          NULL, 100,  6,     '6 kg')
    ON CONFLICT (division_id, station) DO NOTHING;
  END IF;

  -- -------------------------------------------------------
  -- Elite 15 Doubles Men (Pro men weights)
  -- -------------------------------------------------------
  SELECT id INTO div_id FROM hyrox_divisions WHERE division_key = 'elite_15_doubles_men';
  IF div_id IS NOT NULL THEN
    INSERT INTO hyrox_division_stations (division_id, station, distance_meters, reps, weight_kg, weight_note) VALUES
      (div_id, 'SkiErg',              1000, NULL, NULL,  NULL),
      (div_id, 'Sled Push',           50,   NULL, 202,   '202 kg'),
      (div_id, 'Sled Pull',           50,   NULL, 153,   '153 kg'),
      (div_id, 'Broad Jump Burpees',  80,   NULL, NULL,  NULL),
      (div_id, 'Rowing',              1000, NULL, NULL,  NULL),
      (div_id, 'Farmers Carry',       200,  NULL, 64,    '2x32 kg'),
      (div_id, 'Sandbag Lunges',      100,  NULL, 30,    '30 kg'),
      (div_id, 'Wall Balls',          NULL, 100,  9,     '9 kg')
    ON CONFLICT (division_id, station) DO NOTHING;
  END IF;

  -- -------------------------------------------------------
  -- Elite 15 Doubles Mixed (Pro men weights)
  -- -------------------------------------------------------
  SELECT id INTO div_id FROM hyrox_divisions WHERE division_key = 'elite_15_doubles_mixed';
  IF div_id IS NOT NULL THEN
    INSERT INTO hyrox_division_stations (division_id, station, distance_meters, reps, weight_kg, weight_note) VALUES
      (div_id, 'SkiErg',              1000, NULL, NULL,  NULL),
      (div_id, 'Sled Push',           50,   NULL, 202,   '202 kg'),
      (div_id, 'Sled Pull',           50,   NULL, 153,   '153 kg'),
      (div_id, 'Broad Jump Burpees',  80,   NULL, NULL,  NULL),
      (div_id, 'Rowing',              1000, NULL, NULL,  NULL),
      (div_id, 'Farmers Carry',       200,  NULL, 64,    '2x32 kg'),
      (div_id, 'Sandbag Lunges',      100,  NULL, 30,    '30 kg'),
      (div_id, 'Wall Balls',          NULL, 100,  9,     '9 kg')
    ON CONFLICT (division_id, station) DO NOTHING;
  END IF;

  -- -------------------------------------------------------
  -- Relay Women (Open women weights)
  -- -------------------------------------------------------
  SELECT id INTO div_id FROM hyrox_divisions WHERE division_key = 'relay_women';
  IF div_id IS NOT NULL THEN
    INSERT INTO hyrox_division_stations (division_id, station, distance_meters, reps, weight_kg, weight_note) VALUES
      (div_id, 'SkiErg',              1000, NULL, NULL,  NULL),
      (div_id, 'Sled Push',           50,   NULL, 102,   '102 kg'),
      (div_id, 'Sled Pull',           50,   NULL, 78,    '78 kg'),
      (div_id, 'Broad Jump Burpees',  80,   NULL, NULL,  NULL),
      (div_id, 'Rowing',              1000, NULL, NULL,  NULL),
      (div_id, 'Farmers Carry',       200,  NULL, 32,    '2x16 kg'),
      (div_id, 'Sandbag Lunges',      100,  NULL, 10,    '10 kg'),
      (div_id, 'Wall Balls',          NULL, 100,  4,     '4 kg')
    ON CONFLICT (division_id, station) DO NOTHING;
  END IF;

  -- -------------------------------------------------------
  -- Relay Men (Open men weights)
  -- -------------------------------------------------------
  SELECT id INTO div_id FROM hyrox_divisions WHERE division_key = 'relay_men';
  IF div_id IS NOT NULL THEN
    INSERT INTO hyrox_division_stations (division_id, station, distance_meters, reps, weight_kg, weight_note) VALUES
      (div_id, 'SkiErg',              1000, NULL, NULL,  NULL),
      (div_id, 'Sled Push',           50,   NULL, 152,   '152 kg'),
      (div_id, 'Sled Pull',           50,   NULL, 103,   '103 kg'),
      (div_id, 'Broad Jump Burpees',  80,   NULL, NULL,  NULL),
      (div_id, 'Rowing',              1000, NULL, NULL,  NULL),
      (div_id, 'Farmers Carry',       200,  NULL, 48,    '2x24 kg'),
      (div_id, 'Sandbag Lunges',      100,  NULL, 20,    '20 kg'),
      (div_id, 'Wall Balls',          NULL, 100,  6,     '6 kg')
    ON CONFLICT (division_id, station) DO NOTHING;
  END IF;

  -- -------------------------------------------------------
  -- Relay Mixed (Open men weights)
  -- -------------------------------------------------------
  SELECT id INTO div_id FROM hyrox_divisions WHERE division_key = 'relay_mixed';
  IF div_id IS NOT NULL THEN
    INSERT INTO hyrox_division_stations (division_id, station, distance_meters, reps, weight_kg, weight_note) VALUES
      (div_id, 'SkiErg',              1000, NULL, NULL,  NULL),
      (div_id, 'Sled Push',           50,   NULL, 152,   '152 kg'),
      (div_id, 'Sled Pull',           50,   NULL, 103,   '103 kg'),
      (div_id, 'Broad Jump Burpees',  80,   NULL, NULL,  NULL),
      (div_id, 'Rowing',              1000, NULL, NULL,  NULL),
      (div_id, 'Farmers Carry',       200,  NULL, 48,    '2x24 kg'),
      (div_id, 'Sandbag Lunges',      100,  NULL, 20,    '20 kg'),
      (div_id, 'Wall Balls',          NULL, 100,  6,     '6 kg')
    ON CONFLICT (division_id, station) DO NOTHING;
  END IF;

  -- -------------------------------------------------------
  -- Corporate Relay Women (Open women weights)
  -- -------------------------------------------------------
  SELECT id INTO div_id FROM hyrox_divisions WHERE division_key = 'corporate_relay_women';
  IF div_id IS NOT NULL THEN
    INSERT INTO hyrox_division_stations (division_id, station, distance_meters, reps, weight_kg, weight_note) VALUES
      (div_id, 'SkiErg',              1000, NULL, NULL,  NULL),
      (div_id, 'Sled Push',           50,   NULL, 102,   '102 kg'),
      (div_id, 'Sled Pull',           50,   NULL, 78,    '78 kg'),
      (div_id, 'Broad Jump Burpees',  80,   NULL, NULL,  NULL),
      (div_id, 'Rowing',              1000, NULL, NULL,  NULL),
      (div_id, 'Farmers Carry',       200,  NULL, 32,    '2x16 kg'),
      (div_id, 'Sandbag Lunges',      100,  NULL, 10,    '10 kg'),
      (div_id, 'Wall Balls',          NULL, 100,  4,     '4 kg')
    ON CONFLICT (division_id, station) DO NOTHING;
  END IF;

  -- -------------------------------------------------------
  -- Corporate Relay Men (Open men weights)
  -- -------------------------------------------------------
  SELECT id INTO div_id FROM hyrox_divisions WHERE division_key = 'corporate_relay_men';
  IF div_id IS NOT NULL THEN
    INSERT INTO hyrox_division_stations (division_id, station, distance_meters, reps, weight_kg, weight_note) VALUES
      (div_id, 'SkiErg',              1000, NULL, NULL,  NULL),
      (div_id, 'Sled Push',           50,   NULL, 152,   '152 kg'),
      (div_id, 'Sled Pull',           50,   NULL, 103,   '103 kg'),
      (div_id, 'Broad Jump Burpees',  80,   NULL, NULL,  NULL),
      (div_id, 'Rowing',              1000, NULL, NULL,  NULL),
      (div_id, 'Farmers Carry',       200,  NULL, 48,    '2x24 kg'),
      (div_id, 'Sandbag Lunges',      100,  NULL, 20,    '20 kg'),
      (div_id, 'Wall Balls',          NULL, 100,  6,     '6 kg')
    ON CONFLICT (division_id, station) DO NOTHING;
  END IF;

  -- -------------------------------------------------------
  -- Corporate Relay Mixed (Open men weights)
  -- -------------------------------------------------------
  SELECT id INTO div_id FROM hyrox_divisions WHERE division_key = 'corporate_relay_mixed';
  IF div_id IS NOT NULL THEN
    INSERT INTO hyrox_division_stations (division_id, station, distance_meters, reps, weight_kg, weight_note) VALUES
      (div_id, 'SkiErg',              1000, NULL, NULL,  NULL),
      (div_id, 'Sled Push',           50,   NULL, 152,   '152 kg'),
      (div_id, 'Sled Pull',           50,   NULL, 103,   '103 kg'),
      (div_id, 'Broad Jump Burpees',  80,   NULL, NULL,  NULL),
      (div_id, 'Rowing',              1000, NULL, NULL,  NULL),
      (div_id, 'Farmers Carry',       200,  NULL, 48,    '2x24 kg'),
      (div_id, 'Sandbag Lunges',      100,  NULL, 20,    '20 kg'),
      (div_id, 'Wall Balls',          NULL, 100,  6,     '6 kg')
    ON CONFLICT (division_id, station) DO NOTHING;
  END IF;

  -- -------------------------------------------------------
  -- Company Challenge Women (Open women weights)
  -- -------------------------------------------------------
  SELECT id INTO div_id FROM hyrox_divisions WHERE division_key = 'company_challenge_women';
  IF div_id IS NOT NULL THEN
    INSERT INTO hyrox_division_stations (division_id, station, distance_meters, reps, weight_kg, weight_note) VALUES
      (div_id, 'SkiErg',              1000, NULL, NULL,  NULL),
      (div_id, 'Sled Push',           50,   NULL, 102,   '102 kg'),
      (div_id, 'Sled Pull',           50,   NULL, 78,    '78 kg'),
      (div_id, 'Broad Jump Burpees',  80,   NULL, NULL,  NULL),
      (div_id, 'Rowing',              1000, NULL, NULL,  NULL),
      (div_id, 'Farmers Carry',       200,  NULL, 32,    '2x16 kg'),
      (div_id, 'Sandbag Lunges',      100,  NULL, 10,    '10 kg'),
      (div_id, 'Wall Balls',          NULL, 100,  4,     '4 kg')
    ON CONFLICT (division_id, station) DO NOTHING;
  END IF;

  -- -------------------------------------------------------
  -- Company Challenge Men (Open men weights)
  -- -------------------------------------------------------
  SELECT id INTO div_id FROM hyrox_divisions WHERE division_key = 'company_challenge_men';
  IF div_id IS NOT NULL THEN
    INSERT INTO hyrox_division_stations (division_id, station, distance_meters, reps, weight_kg, weight_note) VALUES
      (div_id, 'SkiErg',              1000, NULL, NULL,  NULL),
      (div_id, 'Sled Push',           50,   NULL, 152,   '152 kg'),
      (div_id, 'Sled Pull',           50,   NULL, 103,   '103 kg'),
      (div_id, 'Broad Jump Burpees',  80,   NULL, NULL,  NULL),
      (div_id, 'Rowing',              1000, NULL, NULL,  NULL),
      (div_id, 'Farmers Carry',       200,  NULL, 48,    '2x24 kg'),
      (div_id, 'Sandbag Lunges',      100,  NULL, 20,    '20 kg'),
      (div_id, 'Wall Balls',          NULL, 100,  6,     '6 kg')
    ON CONFLICT (division_id, station) DO NOTHING;
  END IF;

  -- -------------------------------------------------------
  -- Company Challenge Mixed (Open men weights)
  -- -------------------------------------------------------
  SELECT id INTO div_id FROM hyrox_divisions WHERE division_key = 'company_challenge_mixed';
  IF div_id IS NOT NULL THEN
    INSERT INTO hyrox_division_stations (division_id, station, distance_meters, reps, weight_kg, weight_note) VALUES
      (div_id, 'SkiErg',              1000, NULL, NULL,  NULL),
      (div_id, 'Sled Push',           50,   NULL, 152,   '152 kg'),
      (div_id, 'Sled Pull',           50,   NULL, 103,   '103 kg'),
      (div_id, 'Broad Jump Burpees',  80,   NULL, NULL,  NULL),
      (div_id, 'Rowing',              1000, NULL, NULL,  NULL),
      (div_id, 'Farmers Carry',       200,  NULL, 48,    '2x24 kg'),
      (div_id, 'Sandbag Lunges',      100,  NULL, 20,    '20 kg'),
      (div_id, 'Wall Balls',          NULL, 100,  6,     '6 kg')
    ON CONFLICT (division_id, station) DO NOTHING;
  END IF;

  -- -------------------------------------------------------
  -- Adaptive Women (Open women weights, movement mods not weight changes)
  -- -------------------------------------------------------
  SELECT id INTO div_id FROM hyrox_divisions WHERE division_key = 'adaptive_women';
  IF div_id IS NOT NULL THEN
    INSERT INTO hyrox_division_stations (division_id, station, distance_meters, reps, weight_kg, weight_note) VALUES
      (div_id, 'SkiErg',              1000, NULL, NULL,  NULL),
      (div_id, 'Sled Push',           50,   NULL, 102,   '102 kg'),
      (div_id, 'Sled Pull',           50,   NULL, 78,    '78 kg'),
      (div_id, 'Broad Jump Burpees',  80,   NULL, NULL,  NULL),
      (div_id, 'Rowing',              1000, NULL, NULL,  NULL),
      (div_id, 'Farmers Carry',       200,  NULL, 32,    '2x16 kg'),
      (div_id, 'Sandbag Lunges',      100,  NULL, 10,    '10 kg'),
      (div_id, 'Wall Balls',          NULL, 100,  4,     '4 kg')
    ON CONFLICT (division_id, station) DO NOTHING;
  END IF;

  -- -------------------------------------------------------
  -- Adaptive Men (Open men weights)
  -- -------------------------------------------------------
  SELECT id INTO div_id FROM hyrox_divisions WHERE division_key = 'adaptive_men';
  IF div_id IS NOT NULL THEN
    INSERT INTO hyrox_division_stations (division_id, station, distance_meters, reps, weight_kg, weight_note) VALUES
      (div_id, 'SkiErg',              1000, NULL, NULL,  NULL),
      (div_id, 'Sled Push',           50,   NULL, 152,   '152 kg'),
      (div_id, 'Sled Pull',           50,   NULL, 103,   '103 kg'),
      (div_id, 'Broad Jump Burpees',  80,   NULL, NULL,  NULL),
      (div_id, 'Rowing',              1000, NULL, NULL,  NULL),
      (div_id, 'Farmers Carry',       200,  NULL, 48,    '2x24 kg'),
      (div_id, 'Sandbag Lunges',      100,  NULL, 20,    '20 kg'),
      (div_id, 'Wall Balls',          NULL, 100,  6,     '6 kg')
    ON CONFLICT (division_id, station) DO NOTHING;
  END IF;

  -- -------------------------------------------------------
  -- Youngstars 8-9 (both genders, same specs)
  -- -------------------------------------------------------
  FOR div_id IN
    SELECT id FROM hyrox_divisions WHERE division_key IN ('youngstars_8_9_women', 'youngstars_8_9_men')
  LOOP
    INSERT INTO hyrox_division_stations (division_id, station, distance_meters, reps, weight_kg, weight_note) VALUES
      (div_id, 'SkiErg',              300,  NULL, NULL,  NULL),
      (div_id, 'Sled Push',           15,   NULL, NULL,  NULL),
      (div_id, 'Sled Drag',           15,   NULL, NULL,  NULL),
      (div_id, 'Frogger Jumps',       20,   NULL, NULL,  NULL),
      (div_id, 'Rowing',              200,  NULL, NULL,  NULL),
      (div_id, 'Farmers Carry',       50,   NULL, 11.4,  '2x5.7 kg'),
      (div_id, 'Lunges',              20,   NULL, NULL,  'No sandbag'),
      (div_id, 'Wall Ball Squats',    NULL, 30,   1,     '1 kg / 2m target')
    ON CONFLICT (division_id, station) DO NOTHING;
  END LOOP;

  -- -------------------------------------------------------
  -- Youngstars 10-11 (both genders, same specs)
  -- -------------------------------------------------------
  FOR div_id IN
    SELECT id FROM hyrox_divisions WHERE division_key IN ('youngstars_10_11_women', 'youngstars_10_11_men')
  LOOP
    INSERT INTO hyrox_division_stations (division_id, station, distance_meters, reps, weight_kg, weight_note) VALUES
      (div_id, 'SkiErg',              400,  NULL, NULL,  NULL),
      (div_id, 'Sled Push',           15,   NULL, NULL,  NULL),
      (div_id, 'Sled Drag',           15,   NULL, NULL,  NULL),
      (div_id, 'Broad Jump Burpees',  20,   NULL, NULL,  NULL),
      (div_id, 'Rowing',              300,  NULL, NULL,  NULL),
      (div_id, 'Farmers Carry',       50,   NULL, 11.4,  '2x5.7 kg'),
      (div_id, 'Lunges',              20,   NULL, NULL,  'No sandbag'),
      (div_id, 'Wall Ball Squats',    NULL, 40,   2,     '2 kg / 2m target')
    ON CONFLICT (division_id, station) DO NOTHING;
  END LOOP;

  -- -------------------------------------------------------
  -- Youngstars 12-13 (both genders, same specs)
  -- -------------------------------------------------------
  FOR div_id IN
    SELECT id FROM hyrox_divisions WHERE division_key IN ('youngstars_12_13_women', 'youngstars_12_13_men')
  LOOP
    INSERT INTO hyrox_division_stations (division_id, station, distance_meters, reps, weight_kg, weight_note) VALUES
      (div_id, 'SkiErg',              500,  NULL, NULL,  NULL),
      (div_id, 'Sled Push',           30,   NULL, NULL,  NULL),
      (div_id, 'Sled Pull',           30,   NULL, NULL,  NULL),
      (div_id, 'Broad Jump Burpees',  40,   NULL, NULL,  NULL),
      (div_id, 'Rowing',              400,  NULL, NULL,  NULL),
      (div_id, 'Farmers Carry',       100,  NULL, 18.2,  '2x9.1 kg'),
      (div_id, 'Sandbag Lunges',      40,   NULL, NULL,  'Sandbag'),
      (div_id, 'Wall Balls',          NULL, 50,   2,     '2 kg / 2.5m target')
    ON CONFLICT (division_id, station) DO NOTHING;
  END LOOP;

  -- -------------------------------------------------------
  -- Youngstars 14-15 (both genders, same specs)
  -- -------------------------------------------------------
  FOR div_id IN
    SELECT id FROM hyrox_divisions WHERE division_key IN ('youngstars_14_15_women', 'youngstars_14_15_men')
  LOOP
    INSERT INTO hyrox_division_stations (division_id, station, distance_meters, reps, weight_kg, weight_note) VALUES
      (div_id, 'SkiErg',              600,  NULL, NULL,  NULL),
      (div_id, 'Sled Push',           30,   NULL, NULL,  NULL),
      (div_id, 'Sled Pull',           30,   NULL, NULL,  NULL),
      (div_id, 'Broad Jump Burpees',  40,   NULL, NULL,  NULL),
      (div_id, 'Rowing',              500,  NULL, NULL,  NULL),
      (div_id, 'Farmers Carry',       100,  NULL, 22.8,  '2x11.4 kg'),
      (div_id, 'Sandbag Lunges',      40,   NULL, NULL,  'Sandbag'),
      (div_id, 'Wall Balls',          NULL, 50,   4,     '4 kg / 2.5m target')
    ON CONFLICT (division_id, station) DO NOTHING;
  END LOOP;

END $$;
