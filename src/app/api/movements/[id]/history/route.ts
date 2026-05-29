// GET /api/movements/[id]/history
//
// Returns the caller's logged history for a single movement. Used by the
// movement detail page on the CrossFit tab to show weight progression
// over time and Rx-vs-scaled stats.
//
// Unified-schema: score_movement_details →
// crossfit_workout_movements (filtered to this movement_id) →
// workout_sessions (for workoutDate / title). The session.id stands in
// for the legacy workouts.id (it's the day-level handle the client uses).

import { NextResponse } from "next/server";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
  crossfitWorkoutMovements,
  crossfitWorkouts,
  movements,
  scoreMovementDetails,
  scores,
  workoutSessions,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { normalizeSetEntries } from "@/lib/crossfit/set-entries";
import type { SetEntry } from "@/types/crossfit";

export interface MovementHistoryEntry {
  detailId: string;
  scoreId: string;
  workoutId: string;
  workoutPartId: string | null;
  workoutDate: string;
  workoutTitle: string | null;
  actualWeight: string | null;
  setEntries: SetEntry[] | null;
  actualReps: string | null;
  wasRx: boolean;
  modification: string | null;
  notes: string | null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
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
        or(isNull(movements.createdBy), eq(movements.createdBy, user.id))!
      )
    )
    .limit(1);

  if (!movement) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rawLogs = await db
    .select({
      detailId: scoreMovementDetails.id,
      scoreId: scores.id,
      workoutId: workoutSessions.id,
      workoutPartId: scores.crossfitWorkoutPartId,
      workoutDate: workoutSessions.workoutDate,
      sessionTitle: workoutSessions.title,
      templateTitle: crossfitWorkouts.title,
      actualWeight: scoreMovementDetails.actualWeight,
      setEntries: scoreMovementDetails.setEntries,
      actualReps: scoreMovementDetails.actualReps,
      wasRx: scoreMovementDetails.wasRx,
      modification: scoreMovementDetails.modification,
      notes: scoreMovementDetails.notes,
    })
    .from(scoreMovementDetails)
    .innerJoin(scores, eq(scores.id, scoreMovementDetails.scoreId))
    .innerJoin(
      crossfitWorkoutMovements,
      eq(crossfitWorkoutMovements.id, scoreMovementDetails.crossfitWorkoutMovementId)
    )
    .innerJoin(workoutSessions, eq(workoutSessions.id, scores.workoutSessionId))
    .leftJoin(
      crossfitWorkouts,
      eq(crossfitWorkouts.id, workoutSessions.crossfitWorkoutId)
    )
    .where(
      and(
        eq(scores.userId, user.id),
        eq(crossfitWorkoutMovements.movementId, id)
      )
    )
    .orderBy(desc(workoutSessions.workoutDate), desc(scores.createdAt));

  const logs: MovementHistoryEntry[] = rawLogs.map((l) => {
    const entries = normalizeSetEntries(l.setEntries);
    return {
      detailId: l.detailId,
      scoreId: l.scoreId,
      workoutId: l.workoutId,
      workoutPartId: l.workoutPartId,
      workoutDate: l.workoutDate,
      workoutTitle: l.sessionTitle ?? l.templateTitle ?? null,
      actualWeight: l.actualWeight,
      setEntries: entries.length > 0 ? entries : null,
      actualReps: l.actualReps,
      wasRx: l.wasRx,
      modification: l.modification,
      notes: l.notes,
    };
  });

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
    logs,
  });
}
