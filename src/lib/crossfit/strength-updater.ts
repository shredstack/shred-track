// ---------------------------------------------------------------------------
// Athlete movement strength updater.
//
// Pulls every (user, movement) row's worth of qualifying logged sets out of
// the score_movement_details + scores tables, runs the Epley/Brzycki
// estimator over them, picks the best signal, and upserts the result into
// `athlete_movement_strength`.
//
// Two entry points:
//   - `refreshStrengthForMovement(userId, movementId)` — called on score
//     save for every movement touched.
//   - `refreshStrengthForUser(userId)` — full sweep for one user, used by
//     the nightly Inngest job and the backfill seed.
//
// See claude_code_instructions/crossfit_improvements/
//     suggested_working_weight_and_template_history_spec.md §"Source
//     selection" and §"Rejecting bad signal".
// ---------------------------------------------------------------------------

import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  athleteMovementStrength,
  crossfitWorkoutMovements,
  movements,
  scoreMovementDetails,
  scores,
  workoutSessions,
} from "@/db/schema";
import type { SetEntry } from "@/types/crossfit";
import {
  pickBestEstimate,
  shouldRejectSet,
  estimateOneRm,
  type SetSample,
} from "./one-rep-max-estimator";

// Catalog movements treated as "major lifts" for the warm-up reject rule.
// Matches the spec's wording (deadlift, squat, clean).
const MAJOR_LIFT_FRAGMENTS = [
  "deadlift",
  "squat", // back, front, overhead, goblet — all count
  "clean", // clean, power clean, squat clean, hang clean
];

function isMajorLift(canonicalName: string): boolean {
  const lower = canonicalName.toLowerCase();
  return MAJOR_LIFT_FRAGMENTS.some((f) => lower.includes(f));
}

const LOOKBACK_MONTHS = 12;

/**
 * Returns the timestamp cut-off used to filter "recent" sets. Public so the
 * sweep job can use the same threshold for its retire query.
 */
export function strengthLookbackCutoff(now: Date = new Date()): Date {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - LOOKBACK_MONTHS);
  return cutoff;
}

interface MovementMeta {
  id: string;
  canonicalName: string;
  isWeighted: boolean;
  is1rmApplicable: boolean;
}

async function loadMovementMeta(
  movementIds: string[]
): Promise<Map<string, MovementMeta>> {
  if (movementIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: movements.id,
      canonicalName: movements.canonicalName,
      isWeighted: movements.isWeighted,
      is1rmApplicable: movements.is1rmApplicable,
    })
    .from(movements)
    .where(inArray(movements.id, movementIds));
  return new Map(rows.map((r) => [r.id, r]));
}

interface QualifyingSetRow {
  scoreId: string;
  setWeightLb: number;
  setReps: number;
  rpe: number | null;
  wasRx: boolean;
  bodyweightLbAtScore: number | null;
  createdAt: Date;
}

/**
 * Walks scores + score_movement_details for the (user, movement) pair and
 * yields every "set sample" we have to feed the estimator. Handles three
 * shapes:
 *   - `setEntries` jsonb array → one sample per entry
 *   - `actualWeight` + parsed `actualReps` → one sample per row when
 *     `actualReps` is a clean integer (single working weight, e.g. 5 RM)
 *   - `actualWeightLbsPerRound[]` → ignored; per-round captures are reps-
 *     scored work, not strength signal
 */
async function collectQualifyingSets(
  userId: string,
  movementId: string,
  meta: MovementMeta,
  cutoff: Date
): Promise<Array<QualifyingSetRow & SetSample>> {
  const rows = await db
    .select({
      scoreId: scores.id,
      setEntries: scoreMovementDetails.setEntries,
      actualWeight: scoreMovementDetails.actualWeight,
      actualReps: scoreMovementDetails.actualReps,
      wasRx: scoreMovementDetails.wasRx,
      rpe: scores.rpe,
      bodyweightLbAtScore: scores.bodyweightLbAtScore,
      createdAt: scores.createdAt,
    })
    .from(scoreMovementDetails)
    .innerJoin(scores, eq(scores.id, scoreMovementDetails.scoreId))
    .innerJoin(
      crossfitWorkoutMovements,
      eq(
        crossfitWorkoutMovements.id,
        scoreMovementDetails.crossfitWorkoutMovementId
      )
    )
    .where(
      and(
        eq(scores.userId, userId),
        eq(crossfitWorkoutMovements.movementId, movementId),
        gte(scores.createdAt, cutoff)
      )
    )
    .orderBy(desc(scores.createdAt));

  const out: Array<QualifyingSetRow & SetSample> = [];
  const major = isMajorLift(meta.canonicalName);

  for (const r of rows) {
    const bw = r.bodyweightLbAtScore != null ? Number(r.bodyweightLbAtScore) : null;
    const rpe = r.rpe != null ? Number(r.rpe) : null;
    const setEntries = (r.setEntries as SetEntry[] | null) ?? null;

    if (setEntries && setEntries.length > 0) {
      for (const e of setEntries) {
        const w = Number(e?.weight);
        const reps = Number(e?.reps);
        if (!Number.isFinite(w) || !Number.isFinite(reps)) continue;
        const sample: QualifyingSetRow & SetSample = {
          scoreId: r.scoreId,
          setWeightLb: w,
          setReps: reps,
          rpe: e?.rpe ?? rpe,
          wasRx: r.wasRx,
          bodyweightLbAtScore: bw,
          createdAt: r.createdAt,
          weightLb: w,
          reps,
          is1rmApplicable: meta.is1rmApplicable,
          athleteBodyweightLb: bw,
          isMajorLift: major,
        };
        out.push(sample);
      }
      continue;
    }

    // Fallback: actualWeight + actualReps for a 1-shot single-weight log
    // (older flow / load-scored parts without per-set entries).
    const w = r.actualWeight != null ? Number(r.actualWeight) : NaN;
    const reps = parseSingleRepsValue(r.actualReps);
    if (!Number.isFinite(w) || reps == null) continue;
    const sample: QualifyingSetRow & SetSample = {
      scoreId: r.scoreId,
      setWeightLb: w,
      setReps: reps,
      rpe,
      wasRx: r.wasRx,
      bodyweightLbAtScore: bw,
      createdAt: r.createdAt,
      weightLb: w,
      reps,
      is1rmApplicable: meta.is1rmApplicable,
      athleteBodyweightLb: bw,
      isMajorLift: major,
    };
    out.push(sample);
  }

  return out;
}

/**
 * Parse a string rep value into an integer rep count. Accepts "5", "5 reps",
 * etc. Returns null for rep schemes like "21-15-9" (those are reps logged
 * in a metcon, not a working-set count).
 */
function parseSingleRepsValue(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.includes("-")) return null;
  const m = trimmed.match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

/**
 * Refresh the athlete_movement_strength row for one (user, movement). If
 * the user has no qualifying signal, the row is deleted (so a stale row
 * from older data doesn't keep ranking).
 */
export async function refreshStrengthForMovement(
  userId: string,
  movementId: string,
  options: { now?: Date } = {}
): Promise<void> {
  const metaMap = await loadMovementMeta([movementId]);
  const meta = metaMap.get(movementId);
  if (!meta || !meta.isWeighted) return;

  const now = options.now ?? new Date();
  const cutoff = strengthLookbackCutoff(now);
  const samples = await collectQualifyingSets(userId, movementId, meta, cutoff);
  const qualifying = samples.filter((s) => !shouldRejectSet(s));
  if (qualifying.length === 0) {
    await db
      .delete(athleteMovementStrength)
      .where(
        and(
          eq(athleteMovementStrength.userId, userId),
          eq(athleteMovementStrength.movementId, movementId)
        )
      );
    return;
  }

  const best = pickBestEstimate(qualifying);
  if (!best) {
    await db
      .delete(athleteMovementStrength)
      .where(
        and(
          eq(athleteMovementStrength.userId, userId),
          eq(athleteMovementStrength.movementId, movementId)
        )
      );
    return;
  }

  // sample_size: number of qualifying sets across the lookback window.
  // last_observed_at: the freshest qualifying set's createdAt.
  const lastObservedAt = qualifying
    .map((s) => s.createdAt.getTime())
    .reduce((a, b) => Math.max(a, b), 0);

  await db
    .insert(athleteMovementStrength)
    .values({
      userId,
      movementId,
      estimated1rmLb: best.est.estimated1rmLb.toString(),
      source: best.est.method,
      sourceScoreId: best.set.scoreId,
      sourceSetWeightLb: best.set.weightLb.toString(),
      sourceSetReps: best.set.reps,
      sampleSize: qualifying.length,
      lastObservedAt: new Date(lastObservedAt),
      computedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        athleteMovementStrength.userId,
        athleteMovementStrength.movementId,
      ],
      set: {
        estimated1rmLb: best.est.estimated1rmLb.toString(),
        source: best.est.method,
        sourceScoreId: best.set.scoreId,
        sourceSetWeightLb: best.set.weightLb.toString(),
        sourceSetReps: best.set.reps,
        sampleSize: qualifying.length,
        lastObservedAt: new Date(lastObservedAt),
        computedAt: now,
      },
    });
}

/**
 * Sweep every (user, movement) the user has logged a set against in the
 * lookback window. Used by the nightly Inngest job and the one-shot
 * backfill seed.
 */
export async function refreshStrengthForUser(
  userId: string,
  options: { now?: Date } = {}
): Promise<{ refreshed: number; deleted: number }> {
  const now = options.now ?? new Date();
  const cutoff = strengthLookbackCutoff(now);

  const movementIdRows = await db
    .selectDistinct({ movementId: crossfitWorkoutMovements.movementId })
    .from(scoreMovementDetails)
    .innerJoin(scores, eq(scores.id, scoreMovementDetails.scoreId))
    .innerJoin(
      crossfitWorkoutMovements,
      eq(
        crossfitWorkoutMovements.id,
        scoreMovementDetails.crossfitWorkoutMovementId
      )
    )
    .where(and(eq(scores.userId, userId), gte(scores.createdAt, cutoff)));

  const movementIds = movementIdRows.map((r) => r.movementId);
  if (movementIds.length === 0) {
    return { refreshed: 0, deleted: 0 };
  }

  let refreshed = 0;
  for (const movementId of movementIds) {
    const before = await db
      .select({ userId: athleteMovementStrength.userId })
      .from(athleteMovementStrength)
      .where(
        and(
          eq(athleteMovementStrength.userId, userId),
          eq(athleteMovementStrength.movementId, movementId)
        )
      );
    await refreshStrengthForMovement(userId, movementId, { now });
    const after = await db
      .select({ userId: athleteMovementStrength.userId })
      .from(athleteMovementStrength)
      .where(
        and(
          eq(athleteMovementStrength.userId, userId),
          eq(athleteMovementStrength.movementId, movementId)
        )
      );
    if (before.length > 0 || after.length > 0) refreshed++;
  }

  // Drop rows that are no longer backed by any signal in the lookback
  // window (stale entries from movements the athlete hasn't touched).
  const stillTouched = new Set(movementIds);
  const existing = await db
    .select({ movementId: athleteMovementStrength.movementId })
    .from(athleteMovementStrength)
    .where(eq(athleteMovementStrength.userId, userId));

  let deleted = 0;
  for (const row of existing) {
    if (!stillTouched.has(row.movementId)) {
      await db
        .delete(athleteMovementStrength)
        .where(
          and(
            eq(athleteMovementStrength.userId, userId),
            eq(athleteMovementStrength.movementId, row.movementId)
          )
        );
      deleted++;
    }
  }

  return { refreshed, deleted };
}

// Re-export the pure-function pieces so callers (suggestion engine, tests)
// can use them without touching the DB.
export { estimateOneRm, pickBestEstimate, shouldRejectSet };
export type { SetSample };
