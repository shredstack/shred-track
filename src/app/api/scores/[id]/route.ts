import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scores, scoreMovementDetails } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

interface MovementDetailInput {
  workoutMovementId: string;
  wasRx?: boolean;
  actualWeight?: number;
  actualReps?: string;
  modification?: string;
  substitutionMovementId?: string;
  setWeights?: number[];
  notes?: string;
}

// PUT /api/scores/[id] — update a score (and replace movement details)
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
    .from(scores)
    .where(and(eq(scores.id, id), eq(scores.userId, user.id)))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Score not found" }, { status: 404 });
  }

  const details: MovementDetailInput[] | undefined =
    body.movementDetails ?? body.movementScalings;

  let weightLbs = body.weightLbs;
  if (weightLbs == null && details) {
    const maxFromSets = details
      .flatMap((d) => d.setWeights ?? [])
      .reduce<number | null>((max, w) => (max == null || w > max ? w : max), null);
    if (maxFromSets != null) weightLbs = maxFromSets;
  }

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(scores)
      .set({
        division: body.division ?? existing.division,
        timeSeconds: body.timeSeconds ?? existing.timeSeconds,
        rounds: body.rounds ?? existing.rounds,
        remainderReps: body.remainderReps ?? existing.remainderReps,
        weightLbs: weightLbs != null ? weightLbs.toString() : existing.weightLbs,
        totalReps: body.totalReps ?? existing.totalReps,
        scoreText: body.scoreText ?? existing.scoreText,
        hitTimeCap: body.hitTimeCap ?? existing.hitTimeCap,
        notes: body.notes ?? existing.notes,
        rpe: body.rpe ?? existing.rpe,
        updatedAt: new Date(),
      })
      .where(eq(scores.id, id))
      .returning();

    if (details) {
      await tx.delete(scoreMovementDetails).where(eq(scoreMovementDetails.scoreId, id));
      if (details.length > 0) {
        await tx.insert(scoreMovementDetails).values(
          details
            .filter((d) => d.workoutMovementId)
            .map((d) => ({
              scoreId: id,
              workoutMovementId: d.workoutMovementId,
              wasRx: d.wasRx ?? true,
              actualWeight: d.actualWeight != null ? d.actualWeight.toString() : null,
              actualReps: d.actualReps ?? null,
              modification: d.modification ?? null,
              substitutionMovementId: d.substitutionMovementId ?? null,
              setWeights: d.setWeights && d.setWeights.length > 0 ? d.setWeights : null,
              notes: d.notes ?? null,
            }))
        );
      }
    }

    return row;
  });

  return NextResponse.json(updated);
}

// DELETE /api/scores/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const [existing] = await db
    .select()
    .from(scores)
    .where(and(eq(scores.id, id), eq(scores.userId, user.id)))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Score not found" }, { status: 404 });
  }

  await db.delete(scores).where(eq(scores.id, id));

  return NextResponse.json({ deleted: true });
}
