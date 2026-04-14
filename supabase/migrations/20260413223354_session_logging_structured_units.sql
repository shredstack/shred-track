-- Add structured unit columns to hyrox_session_logs for pace, distance, and weight.
-- Existing text columns (actual_pace, actual_distance, actual_weight) are preserved
-- for backward compatibility with already-logged data.

-- Pace: store unit separately so we know if the athlete logged /mi or /km
ALTER TABLE hyrox_session_logs ADD COLUMN actual_pace_unit text;

-- Distance: store as numeric + unit instead of freeform text
ALTER TABLE hyrox_session_logs ADD COLUMN actual_distance_value numeric(8,2);
ALTER TABLE hyrox_session_logs ADD COLUMN actual_distance_unit text;

-- Weight: store as numeric + unit instead of freeform text
ALTER TABLE hyrox_session_logs ADD COLUMN actual_weight_value numeric(8,2);
ALTER TABLE hyrox_session_logs ADD COLUMN actual_weight_unit text;
