import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  benchmarkWorkouts,
  benchmarkWorkoutMovements,
  workouts,
  workoutParts,
  workoutMovements,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getAdminUser } from "@/lib/admin";
import { parseRepScheme } from "@/lib/crossfit/rep-scheme-parser";

// Shape of an incoming movement in the PUT payload. Mirrors the admin
// benchmark form (formToPayload in components/admin/admin-benchmarks.tsx).
type BenchmarkMovementInput = {
  movementId: string;
  orderIndex: number;
  prescribedReps?: string;
  prescribedWeightMale?: number;
  prescribedWeightFemale?: number;
  rxStandard?: string;
  notes?: string;
};

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
    category,
    timeCapSeconds,
    amrapDurationSeconds,
    repScheme,
    isSystem,
    movements: movementsList,
  } = body;

  const VALID_CATEGORIES = new Set([
    "girls",
    "heroes",
    "open",
    "weightlifting",
    "gym_benchmark",
  ]);
  if (category != null && category !== "" && !VALID_CATEGORIES.has(category)) {
    return NextResponse.json(
      { error: "Invalid benchmark category" },
      { status: 400 }
    );
  }

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
        category: category !== undefined ? (category || null) : existing.category,
        timeCapSeconds: timeCapSeconds !== undefined ? (timeCapSeconds || null) : existing.timeCapSeconds,
        amrapDurationSeconds: amrapDurationSeconds !== undefined ? (amrapDurationSeconds || null) : existing.amrapDurationSeconds,
        repScheme: repScheme !== undefined ? (repScheme || null) : existing.repScheme,
        isSystem: isSystem !== undefined ? !!isSystem : existing.isSystem,
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
          (movementsList as BenchmarkMovementInput[]).map((m, i) => ({
            benchmarkWorkoutId: id,
            movementId: m.movementId,
            orderIndex: m.orderIndex ?? i,
            prescribedReps: m.prescribedReps || null,
            prescribedWeightMale: m.prescribedWeightMale?.toString() || null,
            prescribedWeightFemale: m.prescribedWeightFemale?.toString() || null,
            rxStandard: m.rxStandard || null,
            notes: m.notes || null,
          }))
        );
      }
    }

    // Propagate the edit to every workout that was added from this benchmark.
    // Users explicitly opted into "edits flow everywhere" — score history (the
    // `scores` row itself) survives, but per-movement detail rows that hang
    // off removed/replaced workout_movements will cascade. We update existing
    // workout_movements in place (matched by orderIndex) so score detail FKs
    // stay attached when the shape lines up.
    const linkedWorkouts = await tx
      .select({ id: workouts.id })
      .from(workouts)
      .where(eq(workouts.benchmarkWorkoutId, id));

    if (linkedWorkouts.length > 0) {
      const workoutIds = linkedWorkouts.map((w) => w.id);

      await tx
        .update(workouts)
        .set({
          title: updated.name,
          description: updated.description,
          workoutType: updated.workoutType,
          timeCapSeconds: updated.timeCapSeconds,
          amrapDurationSeconds: updated.amrapDurationSeconds,
          repScheme: updated.repScheme,
          updatedAt: new Date(),
        })
        .where(inArray(workouts.id, workoutIds));

      // Benchmark workouts are created single-part (orderIndex 0). Sync that
      // part's structural fields; leave any extra parts the user added alone.
      await tx
        .update(workoutParts)
        .set({
          workoutType: updated.workoutType,
          timeCapSeconds: updated.timeCapSeconds,
          amrapDurationSeconds: updated.amrapDurationSeconds,
          repScheme: updated.repScheme,
        })
        .where(
          and(
            inArray(workoutParts.workoutId, workoutIds),
            eq(workoutParts.orderIndex, 0)
          )
        );

      if (Array.isArray(movementsList)) {
        const inputs = movementsList as BenchmarkMovementInput[];

        for (const wid of workoutIds) {
          const [part] = await tx
            .select({ id: workoutParts.id })
            .from(workoutParts)
            .where(
              and(
                eq(workoutParts.workoutId, wid),
                eq(workoutParts.orderIndex, 0)
              )
            )
            .limit(1);
          if (!part) continue;

          const existingMovs = await tx
            .select({
              id: workoutMovements.id,
              orderIndex: workoutMovements.orderIndex,
            })
            .from(workoutMovements)
            .where(eq(workoutMovements.workoutId, wid))
            .orderBy(workoutMovements.orderIndex);

          const existingByOrder = new Map(
            existingMovs.map((m) => [m.orderIndex, m])
          );

          for (let i = 0; i < inputs.length; i++) {
            const m = inputs[i];
            const orderIndex = m.orderIndex ?? i;
            const values = {
              movementId: m.movementId,
              prescribedReps: m.prescribedReps || null,
              prescribedWeightMale:
                m.prescribedWeightMale != null
                  ? String(m.prescribedWeightMale)
                  : null,
              prescribedWeightFemale:
                m.prescribedWeightFemale != null
                  ? String(m.prescribedWeightFemale)
                  : null,
              repSchemeParsed: parseRepScheme(m.prescribedReps ?? null),
              rxStandard: m.rxStandard || null,
              notes: m.notes || null,
            };
            const existing = existingByOrder.get(orderIndex);
            if (existing) {
              await tx
                .update(workoutMovements)
                .set(values)
                .where(eq(workoutMovements.id, existing.id));
            } else {
              await tx.insert(workoutMovements).values({
                ...values,
                workoutId: wid,
                workoutPartId: part.id,
                orderIndex,
              });
            }
          }

          const orphanIds = existingMovs
            .filter((m) => m.orderIndex >= inputs.length)
            .map((m) => m.id);
          if (orphanIds.length > 0) {
            await tx
              .delete(workoutMovements)
              .where(inArray(workoutMovements.id, orphanIds));
          }
        }
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
