-- ============================================
-- Parsed rep-scheme shape (Phase 2 of gendered_rx_and_rep_ladder_spec)
-- ============================================
--
-- Stores a structured interpretation of `prescribed_reps` alongside the
-- original free text. The parser runs server-side on workout create/update
-- and writes one of:
--
--   { kind: 'fixed',    reps: number }
--   { kind: 'sequence', reps: number[] }
--   { kind: 'ladder',   start: number, step: number, cap?: number, openEnded: boolean }
--   { kind: 'sets',     sets: number, reps: number }
--
-- NULL means the input couldn't be parsed (free text like "AHAP", "1RM",
-- "400m"). The score logger falls back to today's behavior in that case.
--
-- Free-text `prescribed_reps` stays as the source of truth for display.
-- Re-parsing later is just a backfill that touches this column.

ALTER TABLE workout_movements
  ADD COLUMN IF NOT EXISTS rep_scheme_parsed JSONB;

COMMENT ON COLUMN workout_movements.rep_scheme_parsed IS
  'Structured interpretation of prescribed_reps (fixed/sequence/ladder/sets) parsed server-side. NULL when the input is unparseable free text.';
