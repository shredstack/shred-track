// ============================================================
// Calorie estimator — DB → CaloriePartInput[] loader.
// ============================================================
//
// Pulls workout_parts + workout_movements + movements + per-user paces and
// shapes them into the pure-data types the estimator wants. Keeps the
// estimator itself testable without a DB.

import { db } from "@/db";
import {
  crossfitWorkoutMovements,
  crossfitWorkoutParts,
  movements,
  userMovementPaces,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import type {
  CaloriePartInput,
  CaloriePartMovement,
  CalorieMovement,
} from "./types";
import { parseRepScheme, type RepSchemeParsed } from "@/lib/crossfit/rep-scheme-parser";
import { loadUserOneRepMaxes } from "./one-rep-max";

// A working load beyond this multiple of the athlete's estimated 1RM almost
// certainly means a unit mismatch or a stale max — drop it rather than feed
// the estimator a nonsense ratio.
const MAX_PLAUSIBLE_LOAD_PCT = 1.5;

function toNumber(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseMeters(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  // Accept "400m" / "1.5km" / "400" in the prescribed-distance text column.
  const s = String(v).trim().toLowerCase();
  const km = s.match(/^([\d.]+)\s*km$/);
  if (km) return Math.round(parseFloat(km[1]) * 1000);
  const m = s.match(/^([\d.]+)\s*m?$/);
  if (m) return Math.round(parseFloat(m[1]));
  return null;
}

function gendered<T extends string | number | null>(
  male: T,
  female: T,
  gender: string | null | undefined
): T {
  if (gender === "female") return female ?? male;
  return male ?? female;
}

export interface LoadInput {
  /** A `crossfit_workouts.id` post-cutover. */
  workoutId: string;
  /** Optional: when provided, prefer this user's observed paces and 1RMs. */
  userId?: string | null;
  gender?: string | null;
  /**
   * Actual logged working weight (lb) keyed by `crossfit_workout_movements.id`,
   * taken from the score being saved. Combined with the user's estimated 1RM
   * it yields the load-relative MET modifier. Absent → no load scaling.
   */
  actualWeightByWorkoutMovementId?: Map<string, number>;
}

export async function loadEstimatorPartsForWorkout(
  input: LoadInput
): Promise<CaloriePartInput[]> {
  const parts = await db
    .select()
    .from(crossfitWorkoutParts)
    .where(eq(crossfitWorkoutParts.crossfitWorkoutId, input.workoutId));

  if (parts.length === 0) return [];

  const partIds = parts.map((p) => p.id);
  const wms = await db
    .select({
      wm: crossfitWorkoutMovements,
      mv: movements,
    })
    .from(crossfitWorkoutMovements)
    .innerJoin(movements, eq(movements.id, crossfitWorkoutMovements.movementId))
    .where(inArray(crossfitWorkoutMovements.crossfitWorkoutPartId, partIds));

  const movementIds = Array.from(new Set(wms.map((r) => r.mv.id)));
  const paces = input.userId && movementIds.length > 0
    ? await db
        .select()
        .from(userMovementPaces)
        .where(
          and(
            eq(userMovementPaces.userId, input.userId),
            inArray(userMovementPaces.movementId, movementIds)
          )
        )
    : [];
  const paceByMovement = new Map(
    paces.map((p) => [p.movementId, Number(p.repSecondsObserved)])
  );

  // Estimated 1RM per movement — only meaningful for a known athlete, since a
  // 1RM is inherently personal. Template-level estimates skip this entirely.
  const oneRmByMovement =
    input.userId && movementIds.length > 0
      ? await loadUserOneRepMaxes(input.userId, movementIds)
      : new Map<string, number>();
  const actualWeights = input.actualWeightByWorkoutMovementId;

  /**
   * Working load as a fraction of the athlete's estimated 1RM, or null when
   * either side is missing. Keyed by `workout_movements.id` (the logged
   * weight) and `movements.id` (the 1RM).
   */
  function resolveLoadPct1rm(
    workoutMovementId: string,
    movementId: string
  ): number | null {
    const weight = actualWeights?.get(workoutMovementId);
    const oneRm = oneRmByMovement.get(movementId);
    if (weight == null || weight <= 0 || oneRm == null || oneRm <= 0) {
      return null;
    }
    const pct = weight / oneRm;
    return pct > 0 && pct <= MAX_PLAUSIBLE_LOAD_PCT ? pct : null;
  }

  return parts.map((part) => {
    const partMovs = wms.filter((r) => r.wm.crossfitWorkoutPartId === part.id);
    const movs: CaloriePartMovement[] = partMovs.map((row) => {
      const mv: CalorieMovement = {
        id: row.mv.id,
        canonicalName: row.mv.canonicalName,
        metValue: toNumber(row.mv.metValue),
        metIsEstimated: row.mv.metIsEstimated,
        repSecondsDefault: toNumber(row.mv.repSecondsDefault),
        isPacedRun: row.mv.isPacedRun,
        isPacedErg: (row.mv.isPacedErg ?? null) as "row" | "ski" | null,
      };
      const distance = gendered(
        row.wm.prescribedDistanceMale,
        row.wm.prescribedDistanceFemale,
        input.gender
      );
      const duration = gendered(
        row.wm.prescribedDurationSecondsMale,
        row.wm.prescribedDurationSecondsFemale,
        input.gender
      );
      return {
        movement: mv,
        prescribedReps: row.wm.prescribedReps ?? null,
        repSchemeParsed: (row.wm.repSchemeParsed ?? null) as RepSchemeParsed | null,
        prescribedDistanceMeters: parseMeters(distance),
        prescribedDurationSeconds:
          typeof duration === "number" ? duration : toNumber(duration),
        isSideCadence: row.wm.isSideCadence,
        userRepSecondsObserved: paceByMovement.get(row.mv.id) ?? null,
        loadPct1rm: resolveLoadPct1rm(row.wm.id, row.mv.id),
      };
    });

    return {
      id: part.id,
      workoutType: part.workoutType,
      timeCapSeconds: part.timeCapSeconds,
      amrapDurationSeconds: part.amrapDurationSeconds,
      emomIntervalSeconds: part.emomIntervalSeconds,
      intervalWorkSeconds: part.intervalWorkSeconds,
      intervalRestSeconds: part.intervalRestSeconds,
      intervalRounds: (part.intervalRounds ?? null) as
        | Array<{ work: number; rest: number }>
        | null,
      rounds: part.rounds,
      repScheme: part.repScheme,
      // workout_parts.repScheme isn't pre-parsed in the schema (workout_movements
      // is), so parse it on the fly at load time.
      repSchemeParsed: parseRepScheme(part.repScheme),
      structure: part.structure,
      movements: movs,
    } satisfies CaloriePartInput;
  });
}
