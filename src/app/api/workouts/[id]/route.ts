import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { workouts, workoutMovements, movements } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// GET /api/workouts/[id] — single workout with its movements
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const [workout] = await db
    .select()
    .from(workouts)
    .where(eq(workouts.id, id))
    .limit(1);

  if (!workout) {
    return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  }

  const movs = await db
    .select({
      id: workoutMovements.id,
      movementId: workoutMovements.movementId,
      orderIndex: workoutMovements.orderIndex,
      prescribedReps: workoutMovements.prescribedReps,
      prescribedWeightMale: workoutMovements.prescribedWeightMale,
      prescribedWeightFemale: workoutMovements.prescribedWeightFemale,
      rxStandard: workoutMovements.rxStandard,
      notes: workoutMovements.notes,
      movementName: movements.canonicalName,
      movementCategory: movements.category,
    })
    .from(workoutMovements)
    .innerJoin(movements, eq(movements.id, workoutMovements.movementId))
    .where(eq(workoutMovements.workoutId, id))
    .orderBy(workoutMovements.orderIndex);

  return NextResponse.json({ ...workout, movements: movs });
}

// PUT /api/workouts/[id] — update workout
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
      workoutType: body.workoutType ?? existing.workoutType,
      timeCapSeconds: body.timeCapSeconds ?? existing.timeCapSeconds,
      amrapDurationSeconds: body.amrapDurationSeconds ?? existing.amrapDurationSeconds,
      repScheme: body.repScheme ?? existing.repScheme,
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
