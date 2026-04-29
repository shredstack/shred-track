// ---------------------------------------------------------------------------
// GET /api/movements/[id]/history
//
// Returns the caller's logged history for a single movement. Used by the
// movement detail page on the CrossFit tab to show weight progression over
// time and Rx-vs-scaled stats.
//
// Visibility: the movement itself must be visible to the caller — system
// (created_by IS NULL) or owned by the caller. Returns 404 otherwise.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
  movements,
  scoreMovementDetails,
  scores,
  workoutMovements,
  workouts,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";

export interface MovementHistoryEntry {
  detailId: string;
  scoreId: string;
  workoutId: string;
  workoutPartId: string | null;
  workoutDate: string;
  workoutTitle: string | null;
  actualWeight: string | null;
  setWeights: unknown;
  actualReps: string | null;
  wasRx: boolean;
  modification: string | null;
  notes: string | null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const [movement] = await db
    .select()
    .from(movements)
    .where(
      and(
        eq(movements.id, id),
        or(isNull(movements.createdBy), eq(movements.createdBy, user.id))!,
      ),
    )
    .limit(1);

  if (!movement) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const logs = await db
    .select({
      detailId: scoreMovementDetails.id,
      scoreId: scores.id,
      workoutId: workouts.id,
      workoutPartId: scores.workoutPartId,
      workoutDate: workouts.workoutDate,
      workoutTitle: workouts.title,
      actualWeight: scoreMovementDetails.actualWeight,
      setWeights: scoreMovementDetails.setWeights,
      actualReps: scoreMovementDetails.actualReps,
      wasRx: scoreMovementDetails.wasRx,
      modification: scoreMovementDetails.modification,
      notes: scoreMovementDetails.notes,
    })
    .from(scoreMovementDetails)
    .innerJoin(scores, eq(scores.id, scoreMovementDetails.scoreId))
    .innerJoin(
      workoutMovements,
      eq(workoutMovements.id, scoreMovementDetails.workoutMovementId),
    )
    .innerJoin(workouts, eq(workouts.id, workoutMovements.workoutId))
    .where(
      and(
        eq(scores.userId, user.id),
        eq(workoutMovements.movementId, id),
      ),
    )
    .orderBy(desc(workouts.workoutDate), desc(scores.createdAt));

  return NextResponse.json({
    movement: {
      id: movement.id,
      canonicalName: movement.canonicalName,
      category: movement.category,
      isWeighted: movement.isWeighted,
      is1rmApplicable: movement.is1rmApplicable,
      metricType: movement.metricType,
      commonRxWeightMale: movement.commonRxWeightMale,
      commonRxWeightFemale: movement.commonRxWeightFemale,
      videoUrl: movement.videoUrl,
    },
    logs: logs satisfies MovementHistoryEntry[],
  });
}
