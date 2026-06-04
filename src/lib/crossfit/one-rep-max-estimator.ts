// ---------------------------------------------------------------------------
// 1RM estimator.
//
// Uses Epley (reps 6–10) and Brzycki (reps ≤ 5) formulas to back into a
// 1RM from any logged set. Singles (reps=1) are treated as a near-max with
// a small bump unless they were explicitly a max-effort logged at RPE 8+.
//
// References:
//   - Epley B. Poundage Chart. 1985.       est_1rm = w × (1 + r / 30)
//   - Brzycki M. Strength Testing. JOPERD. est_1rm = w × 36 / (37 − r)
//
// See claude_code_instructions/crossfit_improvements/
//     suggested_working_weight_and_template_history_spec.md §"Estimating
//     1RM from any logged set".
// ---------------------------------------------------------------------------

import type { AthleteMovementStrengthSource } from "@/db/schema";

export interface SetSample {
  /** Working weight in lb (the post-warmup load). */
  weightLb: number;
  /** Reps completed at that weight. */
  reps: number;
  /** Whether the set met Rx (if known). Used to gate scaled-variation sets. */
  wasRx?: boolean | null;
  /** RPE 1–10 for this set (if logged). Used to dismiss pacing weights. */
  rpe?: number | null;
  /** Whether the catalog movement is 1RM-applicable. */
  is1rmApplicable?: boolean | null;
  /** Athlete bodyweight (lb) at the time the set was performed. Used to
   *  reject obvious warm-ups for major lifts. */
  athleteBodyweightLb?: number | null;
  /** Major-lift flag (deadlift / squat / clean). Tightens the reject
   *  threshold against bodyweight ratio. */
  isMajorLift?: boolean;
}

export interface EstimatedOneRm {
  estimated1rmLb: number;
  /** Formula used: epley | brzycki | rpe_singleton (RPE-bumped single). */
  method: AthleteMovementStrengthSource;
}

/**
 * Sets we won't trust as strength signal:
 *   - reps out of [1, 10] (formulas diverge fast past 10)
 *   - non-Rx variation on 1RM-applicable movements (scaled barbell)
 *   - weight < 30% bodyweight on major lifts (warm-up logged in a metcon)
 *   - RPE ≤ 5 (pacing weight, not strength indicator)
 */
export function shouldRejectSet(set: SetSample): boolean {
  if (!Number.isFinite(set.weightLb) || set.weightLb <= 0) return true;
  if (!Number.isFinite(set.reps) || set.reps < 1 || set.reps > 10) return true;
  if (set.is1rmApplicable && set.wasRx === false) return true;
  if (set.rpe != null && set.rpe > 0 && set.rpe <= 5) return true;
  if (
    set.isMajorLift &&
    set.athleteBodyweightLb != null &&
    set.athleteBodyweightLb > 0 &&
    set.weightLb / set.athleteBodyweightLb < 0.30
  ) {
    return true;
  }
  return false;
}

/**
 * Estimate a 1RM from a single set. Caller should pre-filter via
 * `shouldRejectSet` — this function does the math unconditionally.
 */
export function estimateOneRm(set: SetSample): EstimatedOneRm {
  const { weightLb, reps, rpe, wasRx } = set;

  // Singles: prefer the value as-is if it was clearly a max effort. A top
  // single at RPE 7 underestimates capacity by ~3% so we bump it. A near-
  // max single with no RPE is treated as a logged_1rm — the spec accepts
  // wasRx=true singles as such.
  if (reps === 1) {
    const isRxMax = wasRx !== false && (rpe == null || rpe >= 8);
    if (isRxMax) {
      return { estimated1rmLb: weightLb, method: "logged_1rm" };
    }
    return {
      estimated1rmLb: roundTo(weightLb * 1.03, 0.5),
      method: "epley_from_set",
    };
  }

  if (reps <= 5) {
    // Brzycki: w × 36 / (37 − r). Diverges as r → 37 (impossible in range).
    const est = weightLb * 36 / (37 - reps);
    return { estimated1rmLb: roundTo(est, 0.5), method: "brzycki_from_set" };
  }

  // Epley: w × (1 + r / 30)
  const est = weightLb * (1 + reps / 30);
  return { estimated1rmLb: roundTo(est, 0.5), method: "epley_from_set" };
}

/**
 * Pick the strongest signal from a list of qualifying sets. Returns the set
 * that produced the highest est-1RM. logged_1rm beats any rep-max
 * estimate of equal magnitude.
 */
export function pickBestEstimate<T extends SetSample>(
  sets: T[]
): { set: T; est: EstimatedOneRm } | null {
  let best: { set: T; est: EstimatedOneRm } | null = null;
  for (const s of sets) {
    if (shouldRejectSet(s)) continue;
    const est = estimateOneRm(s);
    if (!best) {
      best = { set: s, est };
      continue;
    }
    const bestIsLogged = best.est.method === "logged_1rm";
    const candIsLogged = est.method === "logged_1rm";
    if (candIsLogged && !bestIsLogged) {
      best = { set: s, est };
    } else if (est.estimated1rmLb > best.est.estimated1rmLb) {
      best = { set: s, est };
    }
  }
  return best;
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}
