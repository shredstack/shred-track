import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  workouts,
  workoutParts,
  workoutMovements,
  movements,
  scores,
  scoreMovementDetails,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// GET /api/workouts/[id] — single workout with its parts, movements, and
// (if the requester has one) the caller's scores per part.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  const { id } = await params;

  const [workout] = await db
    .select()
    .from(workouts)
    .where(eq(workouts.id, id))
    .limit(1);

  if (!workout) {
    return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  }

  const parts = await db
    .select()
    .from(workoutParts)
    .where(eq(workoutParts.workoutId, id))
    .orderBy(workoutParts.orderIndex);

  const allMovements = await db
    .select({
      id: workoutMovements.id,
      workoutPartId: workoutMovements.workoutPartId,
      movementId: workoutMovements.movementId,
      orderIndex: workoutMovements.orderIndex,
      prescribedReps: workoutMovements.prescribedReps,
      prescribedWeightMale: workoutMovements.prescribedWeightMale,
      prescribedWeightFemale: workoutMovements.prescribedWeightFemale,
      equipmentCount: workoutMovements.equipmentCount,
      rxStandard: workoutMovements.rxStandard,
      notes: workoutMovements.notes,
      movementName: movements.canonicalName,
      movementCategory: movements.category,
      isWeighted: movements.isWeighted,
    })
    .from(workoutMovements)
    .innerJoin(movements, eq(movements.id, workoutMovements.movementId))
    .where(eq(workoutMovements.workoutId, id))
    .orderBy(workoutMovements.orderIndex);

  // Fetch caller's score per part (if any).
  let userScoresByPart = new Map<string, {
    id: string;
    workoutPartId: string | null;
    division: string;
    timeSeconds: number | null;
    rounds: number | null;
    remainderReps: number | null;
    weightLbs: string | null;
    totalReps: number | null;
    scoreText: string | null;
    hitTimeCap: boolean;
    notes: string | null;
    rpe: number | null;
  }>();
  let detailsByScore = new Map<string, Array<{
    workoutMovementId: string;
    wasRx: boolean;
    actualWeight: string | null;
    actualReps: string | null;
    modification: string | null;
    substitutionMovementId: string | null;
    setWeights: unknown;
    notes: string | null;
  }>>();

  if (user) {
    const userScoreRows = await db
      .select()
      .from(scores)
      .where(and(eq(scores.workoutId, id), eq(scores.userId, user.id)));

    userScoresByPart = new Map(
      userScoreRows
        .filter((s) => s.workoutPartId)
        .map((s) => [s.workoutPartId as string, s])
    );

    if (userScoreRows.length > 0) {
      const scoreIds = userScoreRows.map((s) => s.id);
      const detailRows = await db
        .select()
        .from(scoreMovementDetails)
        .where(inArray(scoreMovementDetails.scoreId, scoreIds));
      detailsByScore = new Map();
      for (const d of detailRows) {
        const list = detailsByScore.get(d.scoreId) ?? [];
        list.push({
          workoutMovementId: d.workoutMovementId,
          wasRx: d.wasRx,
          actualWeight: d.actualWeight,
          actualReps: d.actualReps,
          modification: d.modification,
          substitutionMovementId: d.substitutionMovementId,
          setWeights: d.setWeights,
          notes: d.notes,
        });
        detailsByScore.set(d.scoreId, list);
      }
    }
  }

  // Group movements by part.
  const movementsByPart = new Map<string, typeof allMovements>();
  for (const m of allMovements) {
    if (!m.workoutPartId) continue;
    const list = movementsByPart.get(m.workoutPartId) ?? [];
    list.push(m);
    movementsByPart.set(m.workoutPartId, list);
  }

  const partsPayload = parts.map((p) => {
    const score = userScoresByPart.get(p.id);
    return {
      id: p.id,
      orderIndex: p.orderIndex,
      label: p.label,
      workoutType: p.workoutType,
      timeCapSeconds: p.timeCapSeconds,
      amrapDurationSeconds: p.amrapDurationSeconds,
      emomIntervalSeconds: p.emomIntervalSeconds,
      repScheme: p.repScheme,
      rounds: p.rounds,
      notes: p.notes,
      movements: (movementsByPart.get(p.id) ?? []).map((m) => ({
        id: m.id,
        movementId: m.movementId,
        movementName: m.movementName,
        category: m.movementCategory,
        isWeighted: m.isWeighted,
        orderIndex: m.orderIndex,
        prescribedReps: m.prescribedReps,
        prescribedWeightMale: m.prescribedWeightMale,
        prescribedWeightFemale: m.prescribedWeightFemale,
        equipmentCount: m.equipmentCount,
        rxStandard: m.rxStandard,
        notes: m.notes,
      })),
      score: score
        ? {
            id: score.id,
            workoutPartId: score.workoutPartId,
            division: score.division,
            timeSeconds: score.timeSeconds ?? undefined,
            rounds: score.rounds ?? undefined,
            remainderReps: score.remainderReps ?? undefined,
            weightLbs: score.weightLbs ?? undefined,
            totalReps: score.totalReps ?? undefined,
            scoreText: score.scoreText ?? undefined,
            hitTimeCap: score.hitTimeCap,
            notes: score.notes ?? undefined,
            rpe: score.rpe ?? undefined,
            movementDetails: (detailsByScore.get(score.id) ?? []).map((d) => ({
              workoutMovementId: d.workoutMovementId,
              wasRx: d.wasRx,
              actualWeight: d.actualWeight ? Number(d.actualWeight) : undefined,
              actualReps: d.actualReps ?? undefined,
              modification: d.modification ?? undefined,
              substitutionMovementId: d.substitutionMovementId ?? undefined,
              setWeights: Array.isArray(d.setWeights)
                ? (d.setWeights as number[])
                : undefined,
              notes: d.notes ?? undefined,
            })),
          }
        : null,
    };
  });

  return NextResponse.json({ ...workout, parts: partsPayload });
}

// PUT /api/workouts/[id] — update top-level workout metadata.
// Part-level edits are out of scope for this endpoint today.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const [existing] = await db
    .select()
    .from(workouts)
    .where(and(eq(workouts.id, id), eq(workouts.createdBy, user.id)))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Workout not found or not owned by you" }, { status: 404 });
  }

  const [updated] = await db
    .update(workouts)
    .set({
      title: body.title ?? existing.title,
      description: body.description ?? existing.description,
      rawText: body.rawText ?? existing.rawText,
      workoutDate: body.workoutDate ?? existing.workoutDate,
      published: body.published ?? existing.published,
      updatedAt: new Date(),
    })
    .where(eq(workouts.id, id))
    .returning();

  return NextResponse.json(updated);
}

// DELETE /api/workouts/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const [existing] = await db
    .select()
    .from(workouts)
    .where(and(eq(workouts.id, id), eq(workouts.createdBy, user.id)))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Workout not found or not owned by you" }, { status: 404 });
  }

  await db.delete(workouts).where(eq(workouts.id, id));

  return NextResponse.json({ deleted: true });
}
