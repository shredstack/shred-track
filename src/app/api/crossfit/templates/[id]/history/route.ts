// GET /api/crossfit/templates/[id]/history
//
// Returns the calling athlete's prior scores against a unified-schema
// template (crossfit_workouts.id). Powers the "History" sheet that lives
// in every workout-card header.
//
// Same scope as /api/benchmarks/[id]/history (which is specifically for
// benchmarks), but this endpoint works against ANY template — gym-
// programmed WOD, personal Smart Builder one-off, weightlifting auto-
// benchmark, etc. Multi-part templates expose per-part scores; per-
// movement weights are returned inline so the sheet can show what the
// athlete actually used.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  crossfitWorkoutMovements,
  crossfitWorkoutParts,
  crossfitWorkouts,
  movements,
  scoreMovementDetails,
  scores,
  workoutSessions,
} from "@/db/schema";
import { aliasedTable, and, asc, desc, eq, inArray } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { pickBestScore, type ScoreRow } from "@/lib/crossfit/benchmark-stats";
import type { SetEntry, WorkoutType } from "@/types/crossfit";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [template] = await db
    .select({
      id: crossfitWorkouts.id,
      title: crossfitWorkouts.title,
      workoutType: crossfitWorkouts.workoutType,
      isSystem: crossfitWorkouts.isSystem,
      isBenchmark: crossfitWorkouts.isBenchmark,
    })
    .from(crossfitWorkouts)
    .where(eq(crossfitWorkouts.id, id))
    .limit(1);

  if (!template) {
    return NextResponse.json(
      { error: "Template not found" },
      { status: 404 }
    );
  }

  const scoreRows = await db
    .select({
      scoreId: scores.id,
      sessionId: scores.workoutSessionId,
      partId: scores.crossfitWorkoutPartId,
      workoutDate: workoutSessions.workoutDate,
      division: scores.division,
      timeSeconds: scores.timeSeconds,
      rounds: scores.rounds,
      remainderReps: scores.remainderReps,
      weightLbs: scores.weightLbs,
      totalReps: scores.totalReps,
      scoreText: scores.scoreText,
      hitTimeCap: scores.hitTimeCap,
      notes: scores.notes,
      rpe: scores.rpe,
      woreVest: scores.woreVest,
      vestWeightLb: scores.vestWeightLb,
      createdAt: scores.createdAt,
    })
    .from(scores)
    .innerJoin(workoutSessions, eq(workoutSessions.id, scores.workoutSessionId))
    .where(
      and(
        eq(scores.userId, user.id),
        eq(workoutSessions.crossfitWorkoutId, id)
      )
    )
    .orderBy(desc(workoutSessions.workoutDate), desc(scores.createdAt));

  // Per-movement details + part labels (loaded in one round trip each).
  // Substitution movement names come from a self-join alias on `movements`.
  const substitutionMovements = aliasedTable(movements, "sub_movements");
  const scoreIds = scoreRows.map((r) => r.scoreId);
  const movementDetails = scoreIds.length
    ? await db
        .select({
          scoreId: scoreMovementDetails.scoreId,
          crossfitWorkoutMovementId:
            scoreMovementDetails.crossfitWorkoutMovementId,
          wasRx: scoreMovementDetails.wasRx,
          actualWeight: scoreMovementDetails.actualWeight,
          actualReps: scoreMovementDetails.actualReps,
          setEntries: scoreMovementDetails.setEntries,
          modification: scoreMovementDetails.modification,
          actualDurationSeconds: scoreMovementDetails.actualDurationSeconds,
          actualHeightInches: scoreMovementDetails.actualHeightInches,
          actualRepsPerRound: scoreMovementDetails.actualRepsPerRound,
          actualDurationSecondsPerRound:
            scoreMovementDetails.actualDurationSecondsPerRound,
          actualWeightLbsPerRound: scoreMovementDetails.actualWeightLbsPerRound,
          movementName: movements.canonicalName,
          substitutionName: substitutionMovements.canonicalName,
        })
        .from(scoreMovementDetails)
        .leftJoin(
          crossfitWorkoutMovements,
          eq(
            crossfitWorkoutMovements.id,
            scoreMovementDetails.crossfitWorkoutMovementId
          )
        )
        .leftJoin(movements, eq(movements.id, crossfitWorkoutMovements.movementId))
        .leftJoin(
          substitutionMovements,
          eq(
            substitutionMovements.id,
            scoreMovementDetails.substitutionMovementId
          )
        )
        .where(inArray(scoreMovementDetails.scoreId, scoreIds))
    : [];

  const detailsByScore = new Map<string, typeof movementDetails>();
  for (const d of movementDetails) {
    const list = detailsByScore.get(d.scoreId) ?? [];
    list.push(d);
    detailsByScore.set(d.scoreId, list);
  }

  // Compute the PR per part — a multi-part template (Sandbag CrossFit-style
  // workouts) has independent scoring per part.
  const partIds = Array.from(
    new Set(scoreRows.map((r) => r.partId).filter((p): p is string => !!p))
  );
  const partTypeById = new Map<string, WorkoutType>();
  if (partIds.length > 0) {
    const partRows = await db
      .select({
        id: crossfitWorkoutParts.id,
        workoutType: crossfitWorkoutParts.workoutType,
      })
      .from(crossfitWorkoutParts)
      .where(inArray(crossfitWorkoutParts.id, partIds))
      .orderBy(asc(crossfitWorkoutParts.orderIndex));
    for (const p of partRows) {
      partTypeById.set(p.id, p.workoutType as WorkoutType);
    }
  }

  // Group rows by part for PR computation, then map back.
  const rowsByPart = new Map<string, typeof scoreRows>();
  for (const r of scoreRows) {
    if (!r.partId) continue;
    const list = rowsByPart.get(r.partId) ?? [];
    list.push(r);
    rowsByPart.set(r.partId, list);
  }
  const prScoreIds = new Set<string>();
  for (const [partId, rows] of rowsByPart) {
    const partType =
      partTypeById.get(partId) ?? (template.workoutType as WorkoutType);
    const normalized: ScoreRow[] = rows.map((r) => ({
      scoreId: r.scoreId,
      sessionId: r.sessionId,
      workoutDate: r.workoutDate,
      division: r.division,
      timeSeconds: r.timeSeconds,
      rounds: r.rounds,
      remainderReps: r.remainderReps,
      weightLbs: r.weightLbs != null ? Number(r.weightLbs) : null,
      totalReps: r.totalReps,
      scoreText: r.scoreText,
      hitTimeCap: r.hitTimeCap,
      createdAt: r.createdAt.toISOString(),
    }));
    const best = pickBestScore(partType, normalized);
    if (best) prScoreIds.add(best.scoreId);
  }

  const result = scoreRows.map((r) => ({
    scoreId: r.scoreId,
    workoutSessionId: r.sessionId,
    workoutDate: r.workoutDate,
    division: r.division,
    workoutType: template.workoutType as WorkoutType,
    timeSeconds: r.timeSeconds,
    rounds: r.rounds,
    remainderReps: r.remainderReps,
    weightLbs: r.weightLbs != null ? Number(r.weightLbs) : null,
    totalReps: r.totalReps,
    scoreText: r.scoreText,
    hitTimeCap: r.hitTimeCap,
    notes: r.notes,
    rpe: r.rpe != null ? Number(r.rpe) : null,
    woreVest: r.woreVest,
    vestWeightLb: r.vestWeightLb != null ? Number(r.vestWeightLb) : null,
    isPr: prScoreIds.has(r.scoreId),
    createdAt: r.createdAt.toISOString(),
    movements: (detailsByScore.get(r.scoreId) ?? []).map((d) => ({
      crossfitWorkoutMovementId: d.crossfitWorkoutMovementId,
      movementName: d.movementName,
      wasRx: d.wasRx,
      actualWeightLb: d.actualWeight != null ? Number(d.actualWeight) : null,
      actualReps: d.actualReps,
      modification: d.modification,
      substitutionName: d.substitutionName,
      setEntries: (d.setEntries as SetEntry[] | null) ?? null,
      actualDurationSeconds: d.actualDurationSeconds,
      actualHeightInches:
        d.actualHeightInches != null ? Number(d.actualHeightInches) : null,
      actualRepsPerRound: d.actualRepsPerRound,
      actualDurationSecondsPerRound: d.actualDurationSecondsPerRound,
      actualWeightLbsPerRound:
        d.actualWeightLbsPerRound != null
          ? d.actualWeightLbsPerRound.map((n) => Number(n))
          : null,
    })),
  }));

  return NextResponse.json({
    templateId: template.id,
    templateTitle: template.title,
    workoutType: template.workoutType as WorkoutType,
    isBenchmark: template.isBenchmark,
    isSystem: template.isSystem,
    scores: result,
    count: result.length,
  });
}
