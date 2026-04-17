-- Rename "Broad Jump Burpees" to "Burpee Broad Jumps" (the official HYROX station name)

-- Scraped race splits
UPDATE hyrox_public_splits
SET segment_label = 'Burpee Broad Jumps',
    station_name  = 'Burpee Broad Jumps'
WHERE station_name = 'Broad Jump Burpees';

-- Station assessments (user onboarding data)
UPDATE hyrox_station_assessments
SET station = 'Burpee Broad Jumps'
WHERE station = 'Broad Jump Burpees';

-- Division station specs
UPDATE hyrox_division_stations
SET station = 'Burpee Broad Jumps'
WHERE station = 'Broad Jump Burpees';

-- Reference times
UPDATE hyrox_station_reference_times
SET station = 'Burpee Broad Jumps'
WHERE station = 'Broad Jump Burpees';
