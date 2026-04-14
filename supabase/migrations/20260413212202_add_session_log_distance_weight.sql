-- Add actual_distance and actual_weight columns to hyrox_session_logs
-- These fields capture distance (e.g. "5km") and weight (e.g. "20kg") logged by athletes
ALTER TABLE hyrox_session_logs ADD COLUMN actual_distance text;
ALTER TABLE hyrox_session_logs ADD COLUMN actual_weight text;
