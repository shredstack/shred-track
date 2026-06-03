import type { RoundScoreAggregation } from "@/types/crossfit";

// Compute the aggregated score per the part's roundScoreAggregation. For
// 'average', we round to the nearest whole second when writing to
// scores.timeSeconds — the un-rounded per-round array is preserved in
// scores.roundDurationsSeconds for display.
//
// Per-round durations must be strictly positive — a 0 means "round didn't
// happen", not a real result. Callers should pre-filter, but the function
// also self-sanitizes so a stray zero can't silently deflate `fastest` or
// inflate `sum`/`average` if a future caller forgets.
export function aggregateRoundDurations(
  durations: number[],
  aggregation: RoundScoreAggregation | null | undefined
): number {
  const sanitized = durations
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.round(n));
  if (sanitized.length === 0) return 0;
  switch (aggregation ?? "slowest") {
    case "fastest":
      return Math.min(...sanitized);
    case "sum":
      return sanitized.reduce((a, b) => a + b, 0);
    case "average":
      return Math.round(
        sanitized.reduce((a, b) => a + b, 0) / sanitized.length
      );
    case "slowest":
    default:
      return Math.max(...sanitized);
  }
}
