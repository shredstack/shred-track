-- ============================================================================
-- Timed Rounds workout type — "Every X:XX for N rounds; score is slowest /
-- fastest / sum / average round."
--
-- Per-part columns added to all three part tables:
--   - round_score_aggregation: 'slowest' | 'fastest' | 'sum' | 'average'.
--     Required at the application/Zod layer when workout_type = 'timed_rounds'.
--     Nullable in SQL so existing rows (other workout types) don't need backfill.
--   - round_window_seconds: optional per-round window (e.g. 300 for "Every 5:00").
--     When set, the score-entry UI surfaces a warning if a round time exceeds it.
--
-- Per-score column added to scores:
--   - round_durations_seconds: integer[]. One entry per round. Length should
--     equal the part's `rounds` value. Validated at the API boundary.
--
-- The existing `scores.time_seconds` column stores the aggregated value
-- (slowest / fastest / sum / average) so the leaderboard's existing
-- ascending-time sort works without any special case math.
-- ============================================================================

alter table workout_parts
  add column if not exists round_score_aggregation text
    check (
      round_score_aggregation is null
      or round_score_aggregation in ('slowest', 'fastest', 'sum', 'average')
    ),
  add column if not exists round_window_seconds integer
    check (round_window_seconds is null or round_window_seconds > 0);

alter table crossfit_workout_parts
  add column if not exists round_score_aggregation text
    check (
      round_score_aggregation is null
      or round_score_aggregation in ('slowest', 'fastest', 'sum', 'average')
    ),
  add column if not exists round_window_seconds integer
    check (round_window_seconds is null or round_window_seconds > 0);

alter table benchmark_workout_parts
  add column if not exists round_score_aggregation text
    check (
      round_score_aggregation is null
      or round_score_aggregation in ('slowest', 'fastest', 'sum', 'average')
    ),
  add column if not exists round_window_seconds integer
    check (round_window_seconds is null or round_window_seconds > 0);

alter table scores
  add column if not exists round_durations_seconds integer[];
