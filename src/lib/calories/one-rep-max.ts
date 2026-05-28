// ============================================================
// Calorie estimator — per-user 1RM lookup.
// ============================================================
//
// Derives a best-effort estimated 1RM per movement from the athlete's
// for_load / max_effort score history, so the estimator can scale a
// movement's MET by how heavy the working load is relative to that 1RM.
//
// Intentionally lighter than `insights/predicted-1rm.ts`: that module
// produces user-facing predictions with confidence bands and staleness
// tracking. Here we only need a single number per movement to feed a ±20%
// intensity modifier, so a rougher estimate is fine. No DB writes.

import { db } from "@/db";
import {
  crossfitWorkoutMovements,
  crossfitWorkoutParts,
  movements,
  scoreMovementDetails,
  scores,
} from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { normalizeSetEntries, maxWeight } from "@/lib/crossfit/set-entries";
import { estimatedOneRmForSet } from "@/lib/crossfit/insights/predicted-1rm";
import {
  parseRepScheme,
  type RepSchemeParsed,
} from "@/lib/crossfit/rep-scheme-parser";

// Brzycki/Epley lose accuracy past ~12 reps; ignore higher-rep sets for e1RM.
const MAX_REPS_FOR_E1RM = 12;

/** Uniform reps-per-set from a parsed scheme, or null when reps vary. */
function uniformReps(parsed: RepSchemeParsed | null): number | null {
  if (!parsed) return null;
  switch (parsed.kind) {
    case "fixed":
    case "sets":
      return parsed.reps;
    case "sequence": {
      if (parsed.reps.length === 0) return null;
      const first = parsed.reps[0];
      return parsed.reps.every((r) => r === first) ? first : null;
    }
    default:
      return null; // ladder — mixed reps, no single figure
  }
}

/**
 * Best single working weight (lb) recorded in one score-movement detail.
 * Prefers per-set entries (the canonical shape); falls back to the legacy
 * scalar `actual_weight`. Returns null when neither is usable.
 */
export function workingWeightFromSetData(
  actualWeight: number | string | null | undefined,
  setEntries: unknown
): number | null {
  const entries = normalizeSetEntries(setEntries);
  if (entries.length > 0) {
    const max = maxWeight(entries);
    if (max > 0) return max;
  }
  const w = actualWeight != null ? Number(actualWeight) : NaN;
  return Number.isFinite(w) && w > 0 ? w : null;
}

/**
 * Best estimated 1RM (lb) per movement, drawn from the user's for_load and
 * max_effort history. Movements with no usable history are simply absent
 * from the map — callers treat that as "no load scaling available".
 */
export async function loadUserOneRepMaxes(
  userId: string,
  movementIds: string[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (movementIds.length === 0) return result;

  const rows = await db
    .select({
      movementId: crossfitWorkoutMovements.movementId,
      partRepScheme: crossfitWorkoutParts.repScheme,
      movementRepSchemeParsed: crossfitWorkoutMovements.repSchemeParsed,
      actualWeight: scoreMovementDetails.actualWeight,
      setEntries: scoreMovementDetails.setEntries,
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
    .innerJoin(
      crossfitWorkoutParts,
      eq(crossfitWorkoutParts.id, crossfitWorkoutMovements.crossfitWorkoutPartId)
    )
    .innerJoin(movements, eq(movements.id, crossfitWorkoutMovements.movementId))
    .where(
      and(
        eq(scores.userId, userId),
        eq(movements.is1rmApplicable, true),
        inArray(crossfitWorkoutMovements.movementId, movementIds),
        // Only for_load parts (max_effort exists at the template level as
        // workoutType but parts always pivot through for_load in practice).
        inArray(crossfitWorkoutParts.workoutType, ["for_load", "max_effort"])
      )
    );

  for (const row of rows) {
    // Reps come from the per-set entry when present, else the rep scheme —
    // movement-level first (for_load parts carry it there), then part-level.
    const schemeReps =
      uniformReps(
        (row.movementRepSchemeParsed ?? null) as RepSchemeParsed | null
      ) ?? uniformReps(parseRepScheme(row.partRepScheme));

    const entries = normalizeSetEntries(row.setEntries);
    const candidates: Array<{ weight: number; reps: number }> = [];
    if (entries.length > 0) {
      for (const e of entries) {
        const reps = e.reps ?? schemeReps;
        if (e.weight > 0 && reps != null && reps >= 1) {
          candidates.push({ weight: e.weight, reps });
        }
      }
    } else if (row.actualWeight != null && schemeReps != null && schemeReps >= 1) {
      const w = Number(row.actualWeight);
      if (Number.isFinite(w) && w > 0) {
        candidates.push({ weight: w, reps: schemeReps });
      }
    }

    for (const c of candidates) {
      if (c.reps > MAX_REPS_FOR_E1RM) continue;
      const e1rm = estimatedOneRmForSet(c.weight, c.reps);
      if (e1rm <= 0) continue;
      const prev = result.get(row.movementId) ?? 0;
      if (e1rm > prev) result.set(row.movementId, e1rm);
    }
  }

  return result;
}
