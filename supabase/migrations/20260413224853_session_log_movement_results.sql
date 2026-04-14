-- Per-movement results stored as JSONB array.
-- Each entry captures results for a specific movement within a session block.
-- Structure: [{ blockIndex, movementIndex, movementName, timeSeconds?, sets?, weightValue?, weightUnit?, notes? }]
ALTER TABLE hyrox_session_logs ADD COLUMN movement_results jsonb;
