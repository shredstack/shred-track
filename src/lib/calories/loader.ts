// ============================================================
// Calorie estimator — DB → CaloriePartInput[] loader.
// ============================================================
//
// Pulls workout_parts + workout_movements + movements + per-user paces and
// shapes them into the pure-data types the estimator wants. Keeps the
// estimator itself testable without a DB.

import { db } from "@/db";
import {
  workoutParts,
  workoutMovements,
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
  workoutId: string;
  /** Optional: when provided, prefer this user's observed paces. */
  userId?: string | null;
  gender?: string | null;
}

export async function loadEstimatorPartsForWorkout(
  input: LoadInput
): Promise<CaloriePartInput[]> {
  const parts = await db
    .select()
    .from(workoutParts)
    .where(eq(workoutParts.workoutId, input.workoutId));

  if (parts.length === 0) return [];

  const partIds = parts.map((p) => p.id);
  const wms = await db
    .select({
      wm: workoutMovements,
      mv: movements,
    })
    .from(workoutMovements)
    .innerJoin(movements, eq(movements.id, workoutMovements.movementId))
    .where(inArray(workoutMovements.workoutPartId, partIds));

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

  return parts.map((part) => {
    const partMovs = wms.filter((r) => r.wm.workoutPartId === part.id);
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
        loadPct1rm: null,
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
