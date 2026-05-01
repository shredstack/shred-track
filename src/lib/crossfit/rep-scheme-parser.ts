import type {
  MovementCategory,
  MovementMetricType,
} from "@/types/crossfit";

// ============================================
// Default metric-type inference
// ============================================
//
// Mirrors the SQL backfill in 20260427221750_add_metric_type_and_gendered_metrics.
// Used by client-side fallback lists and by code paths that construct
// MovementOption / WorkoutBuilderMovement values without round-tripping
// through the database (tests, mocks, parser-derived placeholders).

export function inferDefaultMetricType(
  canonicalName: string,
  category: MovementCategory,
  isWeighted: boolean
): MovementMetricType {
  // Static-hold / rest movements: anything that's measured by time-held
  // rather than reps. Checked first so a name like "Wall Sit" doesn't fall
  // through to bodyweight reps. Matches "Rest", "Plank", "Hollow Hold",
  // "Wall Sit", "Handstand Hold", "Dead Hang", "L-Sit", etc.
  if (/^rest$/i.test(canonicalName)) return "duration";
  if (/(plank|wall\s*sit|l-?sit|hollow\s*hold|dead\s*hang|handstand\s*hold|hold|hang)$/i.test(canonicalName)) {
    return "duration";
  }

  if (category === "monostructural") {
    if (/(row|ski|bike|echo)/i.test(canonicalName)) return "calories";
    if (/run/i.test(canonicalName)) return "distance";
    return "reps";
  }
  if (isWeighted) return "weight";
  return "reps";
}

// ============================================
// Rep-Scheme Parser
// ============================================
//
// Free-text → structured shape. The shape feeds score decomposition
// (round walking) and any future analytics that need to know what was
// prescribed per round. Anything we can't recognize returns null so the
// caller falls back silently to free-text behavior.
//
// Recognized inputs:
//   "15"               → fixed
//   "21-15-9"          → sequence
//   "3-6-9-12..."      → ladder (open, step inferred)
//   "3-6-9-12+3"       → ladder (open, explicit increment)
//   "3-6-9-12-15"      → sequence (user can promote to ladder via UI toggle)
//   "5x5", "5×5"       → sets
//   "1RM", "AHAP", ""  → null

export type RepSchemeParsed =
  | { kind: "fixed"; reps: number }
  | { kind: "sequence"; reps: number[] }
  | {
      kind: "ladder";
      start: number;
      step: number;
      cap?: number;
      openEnded: boolean;
    }
  | { kind: "sets"; sets: number; reps: number };

const LADDER_OPEN_RE = /^(\d+(?:-\d+)*)\s*-?\s*\.\.\.$/; // "3-6-9-12..." or "3-6-9-12-..."
const LADDER_PLUS_RE = /^(\d+(?:-\d+)*)\s*\+\s*(\d+)$/; // "3-6-9-12+3"
const SETS_RE = /^(\d+)\s*[x×]\s*(\d+)$/i; // "5x5", "5×5", "5 x 5"
const PURE_NUMBER_RE = /^\d+$/;
const SEQUENCE_RE = /^\d+(?:-\d+)+$/; // "21-15-9", "3-6-9"

/**
 * Parse a free-text rep-scheme string into a structured shape, or return
 * null if the input is unparseable / empty. Whitespace is collapsed before
 * pattern matching.
 */
export function parseRepScheme(input: string | null | undefined): RepSchemeParsed | null {
  if (!input) return null;
  const s = input.replace(/\s+/g, "").trim();
  if (!s) return null;

  // "15" → fixed
  if (PURE_NUMBER_RE.test(s)) {
    const reps = parseInt(s, 10);
    if (!Number.isFinite(reps) || reps <= 0) return null;
    return { kind: "fixed", reps };
  }

  // "5x5" / "5×5" → sets
  const setsMatch = s.match(SETS_RE);
  if (setsMatch) {
    const sets = parseInt(setsMatch[1], 10);
    const reps = parseInt(setsMatch[2], 10);
    if (sets > 0 && reps > 0) return { kind: "sets", sets, reps };
    return null;
  }

  // "3-6-9-12..." → ladder, infer step from the listed values
  const openMatch = s.match(LADDER_OPEN_RE);
  if (openMatch) {
    const seed = openMatch[1].split("-").map((n) => parseInt(n, 10));
    if (seed.length === 0 || seed.some((n) => !Number.isFinite(n) || n <= 0)) {
      return null;
    }
    if (seed.length === 1) {
      // "3..." with no second value — can't infer a step.
      return null;
    }
    const step = seed[1] - seed[0];
    if (step <= 0) return null;
    if (seed.length >= 3) {
      // Verify the step is consistent across the seed values; otherwise
      // it's not a true ladder (e.g. "3-7-9-12..." is ambiguous).
      for (let i = 2; i < seed.length; i++) {
        if (seed[i] - seed[i - 1] !== step) return null;
      }
    }
    return { kind: "ladder", start: seed[0], step, openEnded: true };
  }

  // "3-6-9-12+3" → ladder with explicit increment
  const plusMatch = s.match(LADDER_PLUS_RE);
  if (plusMatch) {
    const seed = plusMatch[1].split("-").map((n) => parseInt(n, 10));
    const step = parseInt(plusMatch[2], 10);
    if (seed.length === 0 || seed.some((n) => !Number.isFinite(n) || n <= 0)) {
      return null;
    }
    if (!Number.isFinite(step) || step <= 0) return null;
    return { kind: "ladder", start: seed[0], step, openEnded: true };
  }

  // "21-15-9" / "3-6-9-12-15" → sequence
  if (SEQUENCE_RE.test(s)) {
    const reps = s.split("-").map((n) => parseInt(n, 10));
    if (reps.some((n) => !Number.isFinite(n) || n <= 0)) return null;
    return { kind: "sequence", reps };
  }

  return null;
}

/**
 * Reps prescribed for a given (zero-indexed) round.
 *
 * - fixed:    same reps every round
 * - sequence: reps[i], or reps[last] for rounds past the end
 * - ladder:   start + i × step, optionally clamped at `cap`
 * - sets:     `reps` (each "round" is one set)
 */
export function repsForRound(parsed: RepSchemeParsed, roundIndex: number): number {
  if (roundIndex < 0) return 0;
  switch (parsed.kind) {
    case "fixed":
      return parsed.reps;
    case "sequence":
      if (parsed.reps.length === 0) return 0;
      return parsed.reps[Math.min(roundIndex, parsed.reps.length - 1)];
    case "ladder": {
      const value = parsed.start + roundIndex * parsed.step;
      if (parsed.cap != null) return Math.min(value, parsed.cap);
      return value;
    }
    case "sets":
      return parsed.reps;
  }
}

/**
 * Total reps across all completed rounds (0..completedRounds-1). Useful
 * for surfacing per-movement totals on AMRAP scores.
 */
export function totalRepsThroughRound(
  parsed: RepSchemeParsed,
  completedRounds: number
): number {
  if (completedRounds <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < completedRounds; i++) sum += repsForRound(parsed, i);
  return sum;
}

/**
 * True for ascending arithmetic sequences with ≥3 values and a positive
 * common difference — the only shape we'll let the user "Continue as
 * ladder?" via the builder toggle. Decreasing sequences ("21-15-9") are
 * ruled out because extending them into negative reps is nonsense.
 */
export function canPromoteSequenceToLadder(parsed: RepSchemeParsed): boolean {
  if (parsed.kind !== "sequence") return false;
  if (parsed.reps.length < 3) return false;
  const step = parsed.reps[1] - parsed.reps[0];
  if (step <= 0) return false;
  for (let i = 2; i < parsed.reps.length; i++) {
    if (parsed.reps[i] - parsed.reps[i - 1] !== step) return false;
  }
  return true;
}
