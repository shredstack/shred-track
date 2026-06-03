export type RoundScoreAggregation =
  | "slowest"
  | "fastest"
  | "sum"
  | "average";

// Compute the aggregated score per the part's roundScoreAggregation. For
// 'average', we round to the nearest whole second when writing to
// scores.timeSeconds — the un-rounded per-round array is preserved in
// scores.roundDurationsSeconds for display.
export function aggregateRoundDurations(
  durations: number[],
  aggregation: RoundScoreAggregation | null | undefined
): number {
  const sanitized = durations.map((n) =>
    Number.isFinite(n) && n >= 0 ? Math.round(n) : 0
  );
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
