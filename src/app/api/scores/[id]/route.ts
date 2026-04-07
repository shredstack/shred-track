import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scores } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// PUT /api/scores/[id] — update a score
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

  const [updated] = await db
    .update(scores)
    .set({
      division: body.division ?? existing.division,
      timeSeconds: body.timeSeconds ?? existing.timeSeconds,
      rounds: body.rounds ?? existing.rounds,
      remainderReps: body.remainderReps ?? existing.remainderReps,
      weightLbs: body.weightLbs ?? existing.weightLbs,
      totalReps: body.totalReps ?? existing.totalReps,
      scoreText: body.scoreText ?? existing.scoreText,
      hitTimeCap: body.hitTimeCap ?? existing.hitTimeCap,
      notes: body.notes ?? existing.notes,
      rpe: body.rpe ?? existing.rpe,
      updatedAt: new Date(),
    })
    .where(eq(scores.id, id))
    .returning();

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
