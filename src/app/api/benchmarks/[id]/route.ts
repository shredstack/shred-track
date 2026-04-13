import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { benchmarkWorkouts, benchmarkWorkoutMovements, movements } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// PUT /api/benchmarks/[id] — update a user-created benchmark
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // Verify ownership and not a system benchmark
  const [existing] = await db
    .select()
    .from(benchmarkWorkouts)
    .where(eq(benchmarkWorkouts.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Benchmark not found" }, { status: 404 });
  }

  if (existing.isSystem) {
    return NextResponse.json({ error: "System benchmarks cannot be modified" }, { status: 403 });
  }

  if (existing.createdBy !== user.id) {
    return NextResponse.json({ error: "Not authorized to modify this benchmark" }, { status: 403 });
  }

  const body = await req.json();
  const {
    name,
    description,
    workoutType,
    timeCapSeconds,
    amrapDurationSeconds,
    repScheme,
    movements: movementsList,
  } = body;

  const trimmedName = name?.trim();
  if (!trimmedName || trimmedName.length > 100) {
    return NextResponse.json({ error: "Name is required (max 100 characters)" }, { status: 400 });
  }

  // Check system name conflict if name changed
  if (trimmedName !== existing.name) {
    const systemConflict = await db
      .select({ id: benchmarkWorkouts.id })
      .from(benchmarkWorkouts)
      .where(
        and(
          eq(benchmarkWorkouts.name, trimmedName),
          eq(benchmarkWorkouts.isSystem, true)
        )
      )
      .limit(1);

    if (systemConflict.length > 0) {
      return NextResponse.json(
        { error: "A system benchmark with this name already exists" },
        { status: 409 }
      );
    }
  }

  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(benchmarkWorkouts)
      .set({
        name: trimmedName,
        description: description || null,
        workoutType: workoutType || existing.workoutType,
        timeCapSeconds: timeCapSeconds ?? null,
        amrapDurationSeconds: amrapDurationSeconds ?? null,
        repScheme: repScheme ?? null,
        updatedAt: new Date(),
      })
      .where(eq(benchmarkWorkouts.id, id))
      .returning();

    // Replace movements if provided
    if (Array.isArray(movementsList)) {
      await tx
        .delete(benchmarkWorkoutMovements)
        .where(eq(benchmarkWorkoutMovements.benchmarkWorkoutId, id));

      if (movementsList.length > 0) {
        await tx.insert(benchmarkWorkoutMovements).values(
          movementsList.map(
            (
              m: {
                movementId: string;
                orderIndex: number;
                prescribedReps?: string;
                prescribedWeightMale?: number;
                prescribedWeightFemale?: number;
                rxStandard?: string;
                notes?: string;
              },
              i: number
            ) => ({
              benchmarkWorkoutId: id,
              movementId: m.movementId,
              orderIndex: m.orderIndex ?? i,
              prescribedReps: m.prescribedReps || null,
              prescribedWeightMale: m.prescribedWeightMale?.toString() || null,
              prescribedWeightFemale: m.prescribedWeightFemale?.toString() || null,
              rxStandard: m.rxStandard || null,
              notes: m.notes || null,
            })
          )
        );
      }
    }

    return updated;
  });

  return NextResponse.json(result);
}

// DELETE /api/benchmarks/[id] — delete a user-created benchmark
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const [existing] = await db
    .select()
    .from(benchmarkWorkouts)
    .where(eq(benchmarkWorkouts.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Benchmark not found" }, { status: 404 });
  }

  if (existing.isSystem) {
    return NextResponse.json({ error: "System benchmarks cannot be deleted" }, { status: 403 });
  }

  if (existing.createdBy !== user.id) {
    return NextResponse.json({ error: "Not authorized to delete this benchmark" }, { status: 403 });
  }

  await db.delete(benchmarkWorkouts).where(eq(benchmarkWorkouts.id, id));

  return NextResponse.json({ success: true });
}
