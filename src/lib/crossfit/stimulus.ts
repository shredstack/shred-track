// ---------------------------------------------------------------------------
// Stimulus classifier.
//
// Classifies a workout part into a stimulus class — the variable the
// suggested-weight engine looks up against `stimulus_profiles` to get a
// %1RM band.
//
// Inputs are minimal on purpose: just the fields you can pull from a
// `crossfit_workout_parts` row. The classifier is a pure function so the
// same logic runs server-side at chip-render time and inside unit tests
// for fixture WODs.
//
// See claude_code_instructions/crossfit_improvements/
//     suggested_working_weight_and_template_history_spec.md §"Stimulus
//     classification".
// ---------------------------------------------------------------------------

import type { StimulusClass } from "@/db/schema";

export interface PartForClassification {
  workoutType: string;
  timeCapSeconds?: number | null;
  amrapDurationSeconds?: number | null;
  emomIntervalSeconds?: number | null;
  rounds?: number | null;
  repScheme?: string | null;
  /** [{ workSeconds, restSeconds }] — only used for the `intervals` type. */
  intervalRounds?: { workSeconds: number; restSeconds: number }[] | null;
  intervalWorkSeconds?: number | null;
  intervalRestSeconds?: number | null;
  /** Per-movement category breakdown for the part. `hasOlympic` short-
   *  circuits to `oly_metcon` for metcon-shaped parts. */
  movementCategories: string[];
}

const SHORT_INTENSE_SECONDS = 5 * 60;
const MODERATE_METCON_SECONDS = 15 * 60;

/**
 * Resolves the part's effective time domain in seconds. Returns null when
 * the workout type doesn't have a meaningful time domain (e.g. for_load
 * with no time cap).
 */
export function resolveTimeDomainSeconds(
  part: PartForClassification
): number | null {
  switch (part.workoutType) {
    case "amrap":
      return part.amrapDurationSeconds ?? null;
    case "for_time":
      // Time cap is the upper bound. When unset, treat as moderate (the
      // most common interpretation of "for time, no cap"); the caller can
      // override by passing an explicit cap.
      return part.timeCapSeconds ?? null;
    case "emom": {
      const interval = part.emomIntervalSeconds ?? 60;
      const rounds = part.rounds ?? 0;
      return interval * rounds || null;
    }
    case "intervals": {
      // Per-round (work, rest) array wins when present.
      if (part.intervalRounds && part.intervalRounds.length > 0) {
        return part.intervalRounds.reduce(
          (s, r) => s + r.workSeconds + r.restSeconds,
          0
        );
      }
      const work = part.intervalWorkSeconds ?? 0;
      const rest = part.intervalRestSeconds ?? 0;
      const rounds = part.rounds ?? 0;
      return (work + rest) * rounds || null;
    }
    case "tabata":
      // 8 × :20/:10 = 4 min standard.
      return (part.rounds ?? 8) * 30;
    case "for_reps":
    case "for_calories":
      return part.timeCapSeconds ?? null;
    default:
      return part.timeCapSeconds ?? part.amrapDurationSeconds ?? null;
  }
}

/**
 * Detect rep schemes that imply heavy-strength work (low-rep sets across
 * multiple rounds). Matches "5x5", "3x3", "5x3", "5-5-5", etc.
 */
export function isHeavyRepScheme(repScheme: string | null | undefined): boolean {
  if (!repScheme) return false;
  const cleaned = repScheme.trim().toLowerCase();
  // NxR style
  const nxr = cleaned.match(/^(\d+)\s*x\s*(\d+)$/);
  if (nxr) {
    const reps = Number(nxr[2]);
    return reps >= 1 && reps <= 3;
  }
  // dash-separated rep ladder like "5-5-5" or "3-3-3-3"
  const dashes = cleaned.split("-").filter((s) => /^\d+$/.test(s.trim()));
  if (dashes.length >= 2) {
    const allLow = dashes.every((s) => {
      const n = Number(s);
      return n >= 1 && n <= 3;
    });
    if (allLow) return true;
  }
  return false;
}

/** Same idea as isHeavyRepScheme but for the moderate band (5–8 reps). */
export function isModerateStrengthRepScheme(
  repScheme: string | null | undefined
): boolean {
  if (!repScheme) return false;
  const cleaned = repScheme.trim().toLowerCase();
  const nxr = cleaned.match(/^(\d+)\s*x\s*(\d+)$/);
  if (nxr) {
    const reps = Number(nxr[2]);
    return reps >= 5 && reps <= 8;
  }
  const dashes = cleaned.split("-").filter((s) => /^\d+$/.test(s.trim()));
  if (dashes.length >= 2) {
    const allModerate = dashes.every((s) => {
      const n = Number(s);
      return n >= 5 && n <= 8;
    });
    if (allModerate) return true;
  }
  return false;
}

/**
 * Classify a workout part into a stimulus class.
 *
 * Rules (mirror the spec):
 *   max_effort                                          → strength_heavy
 *   for_load + low-rep scheme                           → strength_heavy
 *   for_load + moderate scheme                          → strength_moderate
 *   for_load (default)                                  → strength_moderate
 *   has_olympic + metcon-shaped                         → oly_metcon
 *   metcon: time ≤ 5min                                 → short_intense
 *           ≤ 15min                                     → moderate_metcon
 *           else                                        → long_metcon
 *   default                                             → moderate_metcon
 */
export function classifyStimulus(
  part: PartForClassification
): StimulusClass {
  const type = part.workoutType;

  if (type === "max_effort") return "strength_heavy";

  if (type === "for_load") {
    if (isHeavyRepScheme(part.repScheme)) return "strength_heavy";
    return "strength_moderate";
  }

  const hasOlympic = part.movementCategories.some((c) => c === "olympic");
  const isMetconShaped =
    type === "amrap" ||
    type === "for_time" ||
    type === "for_reps" ||
    type === "for_calories" ||
    type === "emom" ||
    type === "intervals" ||
    type === "tabata" ||
    type === "timed_rounds";

  if (hasOlympic && isMetconShaped) {
    return "oly_metcon";
  }

  if (isMetconShaped) {
    const timeDomain = resolveTimeDomainSeconds(part);
    if (timeDomain != null) {
      if (timeDomain <= SHORT_INTENSE_SECONDS) return "short_intense";
      if (timeDomain <= MODERATE_METCON_SECONDS) return "moderate_metcon";
      return "long_metcon";
    }
    return "moderate_metcon";
  }

  return "moderate_metcon";
}
