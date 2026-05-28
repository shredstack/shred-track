// ============================================================
// Orchestrator: DB → estimator → DB writes.
// ============================================================
//
// Three entry points:
//   • computeAndStoreWorkoutEstimate(workoutId) — template-level (75 kg)
//   • computeScoreEstimate({ scoreId | workoutId, userId, ... }) — personalized
//   • estimateCaloriesForWorkout(...) — read-only helper used by APIs
//
// Each entry point loads the right data, calls the pure estimator, and
// persists the four kcal variants on the right rows.

import { db } from "@/db";
import {
  workouts,
  workoutParts,
  scores,
  scoreMovementDetails,
  users,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { estimateCalories, resolveBodyweightKg, REFERENCE_KG } from "./estimator";
import { loadEstimatorPartsForWorkout } from "./loader";
import { workingWeightFromSetData } from "./one-rep-max";
import { resolveEpocMultiplier } from "./preferences";
import type {
  CalorieEstimate,
  CalorieEstimatorInput,
  CalorieScoreContext,
} from "./types";
import { scopeToScoredPart, type ScoredPartEstimate } from "./part-scope";

// ----- Template-level (75 kg reference) -----

export async function computeAndStoreWorkoutEstimate(
  workoutId: string
): Promise<CalorieEstimate | null> {
  const parts = await loadEstimatorPartsForWorkout({ workoutId });
  if (parts.length === 0) return null;

  const input: CalorieEstimatorInput = {
    parts,
    bodyweightKg: REFERENCE_KG,
    isDefaultBodyweight: false, // 75 kg is a stated reference, not a fallback
    scoreContext: null,
    epocMultiplier: 1.0,
  };
  const estimate = estimateCalories(input);

  await db.transaction(async (tx) => {
    await tx
      .update(workouts)
      .set({
        estimatedKcalLow: estimate.low,
        estimatedKcalHigh: estimate.high,
        estimatedKcalMethod: estimate.method,
        estimatedKcalConfidence: estimate.confidence,
        estimatedKcalComputedAt: new Date(),
      })
      .where(eq(workouts.id, workoutId));

    for (const part of estimate.parts) {
      const partActive = part.kcalActive;
      await tx
        .update(workoutParts)
        .set({
          estimatedKcalLow: Math.round(partActive * 0.85),
          estimatedKcalHigh: Math.round(partActive * 1.15),
          estimatedKcalConfidence: part.confidence,
        })
        .where(eq(workoutParts.id, part.partId));
    }
  });

  return estimate;
}

// ----- Personalized (score time) -----

export interface ComputeScoreEstimateInput {
  scoreId?: string;
  workoutId: string;
  /**
   * The part this score is logged against. A score is always for one part —
   * passing it lets us persist that part's slice of the estimate rather than
   * the whole-workout total. Null only for legacy part-less scores.
   */
  workoutPartId?: string | null;
  userId: string;
  /** From the scores POST body — duplicated so the caller doesn't need to re-read. */
  score: {
    timeSeconds: number | null;
    hitTimeCap: boolean;
    woreVest: boolean | null;
    vestWeightLb: number | null;
    rpe: number | null;
    startedAt: Date | null;
    endedAt: Date | null;
  };
  /** Optional override; otherwise read from `users.activeCommunityId`. */
  communityId?: string | null;
  /**
   * Actual logged working weight (lb) per `workout_movements.id`. Drives the
   * load-relative MET modifier. The score-save handler builds this from the
   * per-movement details in the POST body (the score row doesn't exist yet).
   */
  movementWeights?: Map<string, number>;
}

export interface ComputeScoreEstimateResult {
  /** Full-workout estimate (all parts). Kept for aggregate callers. */
  estimate: CalorieEstimate;
  /**
   * This score's part only. A score is logged against a single part, so this
   * — not `estimate` — is what the score row persists. For a single-part
   * workout it equals the workout total.
   */
  part: ScoredPartEstimate;
  bodyweightLb: number | null;
  isDefaultBodyweight: boolean;
}

/**
 * Compute the personalized estimate for a single user logging a score against
 * a workout. Does NOT persist — the score-save handler decides how to merge
 * this into the scores row write (so it can stay inside the existing
 * transaction). Returns the estimate plus the bodyweight snapshot.
 */
export async function computeScoreEstimate(
  input: ComputeScoreEstimateInput
): Promise<ComputeScoreEstimateResult> {
  const [user] = await db
    .select({
      bodyWeightLb: users.bodyWeightLb,
      gender: users.gender,
      activeCommunityId: users.activeCommunityId,
    })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  const bodyWeightLb = user?.bodyWeightLb != null ? Number(user.bodyWeightLb) : null;
  const bw = resolveBodyweightKg({
    bodyWeightLb,
    gender: user?.gender,
  });

  const parts = await loadEstimatorPartsForWorkout({
    workoutId: input.workoutId,
    userId: input.userId,
    gender: user?.gender ?? null,
    actualWeightByWorkoutMovementId: input.movementWeights,
  });

  const scoreContext: CalorieScoreContext = {
    timeSeconds: input.score.timeSeconds,
    hitTimeCap: input.score.hitTimeCap,
    woreVest: input.score.woreVest,
    vestWeightLb: input.score.vestWeightLb,
    rpe: input.score.rpe,
    startedAt: input.score.startedAt,
    endedAt: input.score.endedAt,
  };

  const epocMultiplier = await resolveEpocMultiplier({
    userId: input.userId,
    communityId: input.communityId ?? user?.activeCommunityId ?? null,
  });

  const estimate = estimateCalories({
    parts,
    bodyweightKg: bw.kg,
    isDefaultBodyweight: bw.isDefault,
    scoreContext,
    epocMultiplier,
  });

  return {
    estimate,
    part: scopeToScoredPart(
      estimate,
      input.workoutPartId,
      epocMultiplier,
      bw.isDefault
    ),
    bodyweightLb: bw.isDefault ? null : bodyWeightLb,
    isDefaultBodyweight: bw.isDefault,
  };
}

/**
 * Convenience: load a score, recompute its kcal columns, and persist. Used by
 * admin recompute paths after a MET edit. Snapshots bodyweight from the
 * existing row so historical scores never get retroactively re-weighted.
 */
export async function recomputeScoreEstimate(scoreId: string): Promise<void> {
  const [row] = await db
    .select({
      id: scores.id,
      userId: scores.userId,
      workoutId: scores.workoutId,
      workoutPartId: scores.workoutPartId,
      timeSeconds: scores.timeSeconds,
      hitTimeCap: scores.hitTimeCap,
      woreVest: scores.woreVest,
      vestWeightLb: scores.vestWeightLb,
      rpe: scores.rpe,
      startedAt: scores.startedAt,
      endedAt: scores.endedAt,
      bodyweightLbAtScore: scores.bodyweightLbAtScore,
    })
    .from(scores)
    .where(eq(scores.id, scoreId))
    .limit(1);

  if (!row) return;
  // Legacy-tree recompute: bail when the row was written post-cutover (it
  // carries `workout_session_id` / `crossfit_workout_part_id` but no legacy
  // workoutId). The unified-schema recompute path lands with the rest of
  // the calorie reader cutover in commit #6.
  if (!row.workoutId) return;

  // Rebuild the per-movement working weights from the persisted detail rows
  // so a recompute reproduces the load-relative modifier.
  const details = await db
    .select({
      workoutMovementId: scoreMovementDetails.workoutMovementId,
      actualWeight: scoreMovementDetails.actualWeight,
      setEntries: scoreMovementDetails.setEntries,
    })
    .from(scoreMovementDetails)
    .where(eq(scoreMovementDetails.scoreId, scoreId));
  const movementWeights = new Map<string, number>();
  for (const d of details) {
    const w = workingWeightFromSetData(d.actualWeight, d.setEntries);
    if (w != null) movementWeights.set(d.workoutMovementId, w);
  }

  const result = await computeScoreEstimate({
    scoreId: row.id,
    workoutId: row.workoutId,
    workoutPartId: row.workoutPartId,
    userId: row.userId,
    movementWeights,
    score: {
      timeSeconds: row.timeSeconds,
      hitTimeCap: row.hitTimeCap,
      woreVest: row.woreVest,
      vestWeightLb: row.vestWeightLb != null ? Number(row.vestWeightLb) : null,
      rpe: row.rpe,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
    },
  });

  await db
    .update(scores)
    .set({
      estimatedKcal: result.part.gross,
      estimatedKcalActive: result.part.active,
      estimatedKcalWithEpoc: result.part.grossWithEpoc,
      estimatedKcalActiveWithEpoc: result.part.activeWithEpoc,
      estimatedKcalMethod: result.part.method,
      estimatedKcalConfidence: result.part.confidence,
    })
    .where(eq(scores.id, scoreId));
}
