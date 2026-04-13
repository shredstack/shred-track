import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { benchmarkWorkouts, benchmarkWorkoutMovements } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getAdminUser } from "@/lib/admin";

// PUT /api/admin/benchmarks/[id] — update any benchmark (admin can edit system benchmarks)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
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

  const [existing] = await db
    .select()
    .from(benchmarkWorkouts)
    .where(eq(benchmarkWorkouts.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Benchmark not found" }, { status: 404 });
  }

  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(benchmarkWorkouts)
      .set({
        name: name?.trim() || existing.name,
        description: description !== undefined ? (description || null) : existing.description,
        workoutType: workoutType || existing.workoutType,
        timeCapSeconds: timeCapSeconds !== undefined ? (timeCapSeconds || null) : existing.timeCapSeconds,
        amrapDurationSeconds: amrapDurationSeconds !== undefined ? (amrapDurationSeconds || null) : existing.amrapDurationSeconds,
        repScheme: repScheme !== undefined ? (repScheme || null) : existing.repScheme,
        updatedAt: new Date(),
      })
      .where(eq(benchmarkWorkouts.id, id))
      .returning();

    if (Array.isArray(movementsList)) {
      await tx
        .delete(benchmarkWorkoutMovements)
        .where(eq(benchmarkWorkoutMovements.benchmarkWorkoutId, id));

      if (movementsList.length > 0) {
        await tx.insert(benchmarkWorkoutMovements).values(
          movementsList.map(
            (m: {
              movementId: string;
              orderIndex: number;
              prescribedReps?: string;
              prescribedWeightMale?: number;
              prescribedWeightFemale?: number;
              rxStandard?: string;
              notes?: string;
            }, i: number) => ({
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

// DELETE /api/admin/benchmarks/[id] — delete any benchmark (admin only)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await db.delete(benchmarkWorkouts).where(eq(benchmarkWorkouts.id, id));
  return NextResponse.json({ success: true });
}
