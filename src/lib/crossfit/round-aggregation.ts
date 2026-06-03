import type { RoundScoreAggregation } from "@/types/crossfit";

export type ValidateRoundDurationsResult =
  | { ok: true; aggregate: number | null; durations: number[] | null }
  | { ok: false; error: string; status: number };

// Shared between POST /api/scores and PUT /api/scores/[id]. Returns
// `{ aggregate: null, durations: null }` for non-timed_rounds parts and for
// timed_rounds requests that don't supply per-round data (e.g. a notes-only
// edit). Returns `{ ok: false }` with an HTTP-shaped error for the two
// recoverable bad-input cases.
export function validateAndAggregateRoundDurations(
  partRow: {
    workoutType: string | null;
    rounds: number | null;
    roundScoreAggregation: string | null;
  } | null | undefined,
  body: { roundDurationsSeconds?: unknown }
): ValidateRoundDurationsResult {
  if (partRow?.workoutType !== "timed_rounds") {
    return { ok: true, aggregate: null, durations: null };
  }
  // Per-round times must be strictly positive: a 0 means the round didn't
  // happen, not a real result. Mirrors the client's filter so the displayed
  // live aggregate matches what the server stores.
  const supplied = Array.isArray(body.roundDurationsSeconds)
    ? body.roundDurationsSeconds.filter(
        (n): n is number =>
          typeof n === "number" && Number.isFinite(n) && n > 0
      )
    : null;
  if (!supplied || supplied.length === 0) {
    return { ok: true, aggregate: null, durations: null };
  }
  if (partRow.rounds == null) {
    return {
      ok: false,
      status: 400,
      error:
        "This part has no round count configured; contact the workout author.",
    };
  }
  if (supplied.length !== partRow.rounds) {
    return {
      ok: false,
      status: 400,
      error: `roundDurationsSeconds.length (${supplied.length}) must equal part.rounds (${partRow.rounds}); each round must be a positive number of seconds`,
    };
  }
  const durations = supplied.map((n) => Math.round(n));
  const aggregate = aggregateRoundDurations(
    durations,
    partRow.roundScoreAggregation as RoundScoreAggregation | null
  );
  return { ok: true, aggregate, durations };
}

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
