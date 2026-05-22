// ============================================================
// Calorie estimator — part scoping.
// ============================================================
// A score is logged against a single workout part, but the estimator works
// the whole workout at once. This narrows a full-workout estimate down to the
// one part a score should persist — without it, every part's score row would
// store the workout total. Pure: no DB, no fetch.

import type { CalorieEstimate, Confidence, EstimateMethod } from "./types";

/**
 * The slice of a workout estimate that belongs to one part — i.e. exactly
 * what a single score row should store. All four kcal flavors are
 * pre-computed so the EPOC / active toggles stay display-time flips.
 */
export interface ScoredPartEstimate {
  gross: number;
  active: number;
  grossWithEpoc: number;
  activeWithEpoc: number;
  confidence: Confidence;
  method: EstimateMethod;
}

// Confidence is high → medium → low; one step worse, clamped at "low".
const CONFIDENCE_RANK: Confidence[] = ["high", "medium", "low"];
function worseConfidence(c: Confidence): Confidence {
  const i = CONFIDENCE_RANK.indexOf(c);
  return CONFIDENCE_RANK[Math.min(i + 1, CONFIDENCE_RANK.length - 1)];
}

/**
 * Narrow a full-workout estimate down to the one part a score belongs to.
 * Falls back to the workout total when the part can't be matched (legacy
 * part-less scores) — which is also the correct answer for a single-part
 * workout, where the part slice and the workout total are the same thing.
 */
export function scopeToScoredPart(
  estimate: CalorieEstimate,
  workoutPartId: string | null | undefined,
  epocMultiplier: number,
  isDefaultBodyweight: boolean
): ScoredPartEstimate {
  const partEst = workoutPartId
    ? estimate.parts.find((p) => p.partId === workoutPartId)
    : undefined;

  if (!partEst) {
    return {
      gross: estimate.gross,
      active: estimate.active,
      grossWithEpoc: estimate.grossWithEpoc,
      activeWithEpoc: estimate.activeWithEpoc,
      confidence: estimate.confidence,
      method: estimate.method,
    };
  }

  const epoc = Math.max(1, epocMultiplier);
  // `estimate.parts` carries the raw per-part confidence; the workout-level
  // default-bodyweight demotion is re-applied here so a part score's
  // confidence matches what the workout total would have reported.
  const confidence = isDefaultBodyweight
    ? worseConfidence(partEst.confidence)
    : partEst.confidence;

  return {
    gross: partEst.kcalTotal,
    active: partEst.kcalActive,
    grossWithEpoc: Math.round(partEst.kcalTotal * epoc),
    activeWithEpoc: Math.round(partEst.kcalActive * epoc),
    confidence,
    method: estimate.method,
  };
}
