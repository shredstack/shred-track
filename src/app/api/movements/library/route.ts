// ---------------------------------------------------------------------------
// GET /api/movements/library
//
// Powers the user-facing CrossFit Movements tab. Returns every validated
// movement visible to the caller (system + the caller's own validated rows)
// plus per-user usage stats so the list can show "last logged" / "Rx %".
//
// Stats source: score_movement_details rows tied to the caller's scores,
// joined via crossfit_workout_movements → crossfit_workout_parts →
// workout_sessions to recover the workoutDate. Substitution movements
// (score_movement_details.substitution_movement_id) are intentionally not
// counted — we key on the prescribed movement.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  crossfitWorkoutMovements,
  crossfitWorkoutParts,
  movements,
  scoreMovementDetails,
  scores,
  workoutSessions,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";

export interface MovementLibraryRow {
  id: string;
  canonicalName: string;
  category: string;
  isWeighted: boolean;
  is1rmApplicable: boolean;
  metricType: string;
  commonRxWeightMale: string | null;
  commonRxWeightFemale: string | null;
  videoUrl: string | null;
  isOwn: boolean;
  stats: {
    logCount: number;
    rxCount: number;
    lastLoggedAt: string | null;
  };
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const visibleMovements = await db
    .select({
      id: movements.id,
      canonicalName: movements.canonicalName,
      category: movements.category,
      isWeighted: movements.isWeighted,
      is1rmApplicable: movements.is1rmApplicable,
      metricType: movements.metricType,
      commonRxWeightMale: movements.commonRxWeightMale,
      commonRxWeightFemale: movements.commonRxWeightFemale,
      videoUrl: movements.videoUrl,
      createdBy: movements.createdBy,
    })
    .from(movements)
    .where(
      and(
        eq(movements.isValidated, true),
        or(isNull(movements.createdBy), eq(movements.createdBy, user.id))!
      )
    )
    .orderBy(movements.canonicalName);

  // Stats join: score_movement_details → crossfit_workout_movements →
  // crossfit_workout_parts → workout_sessions. Pre-cutover rows that lack
  // a crossfitWorkoutMovementId fall out of the join; they're picked up
  // again via the dual-FK union after the legacy drop migration retires
  // both columns into one canonical FK.
  const statsRows = await db
    .select({
      movementId: crossfitWorkoutMovements.movementId,
      logCount: sql<number>`count(*)::int`,
      rxCount: sql<number>`sum(case when ${scoreMovementDetails.wasRx} then 1 else 0 end)::int`,
      lastLoggedAt: sql<string | null>`max(${workoutSessions.workoutDate})::text`,
    })
    .from(scoreMovementDetails)
    .innerJoin(scores, eq(scores.id, scoreMovementDetails.scoreId))
    .innerJoin(
      crossfitWorkoutMovements,
      eq(crossfitWorkoutMovements.id, scoreMovementDetails.crossfitWorkoutMovementId)
    )
    .innerJoin(
      crossfitWorkoutParts,
      eq(crossfitWorkoutParts.id, crossfitWorkoutMovements.crossfitWorkoutPartId)
    )
    .innerJoin(workoutSessions, eq(workoutSessions.id, scores.workoutSessionId))
    .where(eq(scores.userId, user.id))
    .groupBy(crossfitWorkoutMovements.movementId);

  const statsByMovement = new Map(statsRows.map((r) => [r.movementId, r]));

  const result: MovementLibraryRow[] = visibleMovements.map((m) => {
    const s = statsByMovement.get(m.id);
    return {
      id: m.id,
      canonicalName: m.canonicalName,
      category: m.category,
      isWeighted: m.isWeighted,
      is1rmApplicable: m.is1rmApplicable,
      metricType: m.metricType,
      commonRxWeightMale: m.commonRxWeightMale,
      commonRxWeightFemale: m.commonRxWeightFemale,
      videoUrl: m.videoUrl,
      isOwn: m.createdBy === user.id,
      stats: {
        logCount: s?.logCount ?? 0,
        rxCount: s?.rxCount ?? 0,
        lastLoggedAt: s?.lastLoggedAt ?? null,
      },
    };
  });

  return NextResponse.json(result);
}
