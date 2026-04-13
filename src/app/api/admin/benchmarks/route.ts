import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { benchmarkWorkouts, benchmarkWorkoutMovements, movements } from "@/db/schema";
import { eq, asc, inArray } from "drizzle-orm";
import { getAdminUser } from "@/lib/admin";

// GET /api/admin/benchmarks — list all benchmarks (admin only, includes system)
export async function GET(_req: NextRequest) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select()
    .from(benchmarkWorkouts)
    .orderBy(asc(benchmarkWorkouts.name));

  const benchmarkIds = rows.map((r) => r.id);
  const allMovements =
    benchmarkIds.length > 0
      ? await db
          .select({
            id: benchmarkWorkoutMovements.id,
            benchmarkWorkoutId: benchmarkWorkoutMovements.benchmarkWorkoutId,
            movementId: benchmarkWorkoutMovements.movementId,
            movementName: movements.canonicalName,
            orderIndex: benchmarkWorkoutMovements.orderIndex,
            prescribedReps: benchmarkWorkoutMovements.prescribedReps,
            prescribedWeightMale: benchmarkWorkoutMovements.prescribedWeightMale,
            prescribedWeightFemale: benchmarkWorkoutMovements.prescribedWeightFemale,
            rxStandard: benchmarkWorkoutMovements.rxStandard,
          })
          .from(benchmarkWorkoutMovements)
          .innerJoin(movements, eq(benchmarkWorkoutMovements.movementId, movements.id))
          .where(inArray(benchmarkWorkoutMovements.benchmarkWorkoutId, benchmarkIds))
          .orderBy(benchmarkWorkoutMovements.orderIndex)
      : [];

  const movementsByBenchmark = new Map<string, typeof allMovements>();
  for (const m of allMovements) {
    const list = movementsByBenchmark.get(m.benchmarkWorkoutId) || [];
    list.push(m);
    movementsByBenchmark.set(m.benchmarkWorkoutId, list);
  }

  const result = rows.map((bw) => ({
    ...bw,
    movements: (movementsByBenchmark.get(bw.id) || []).map((m) => ({
      id: m.id,
      movementId: m.movementId,
      movementName: m.movementName,
      orderIndex: m.orderIndex,
      prescribedReps: m.prescribedReps,
      prescribedWeightMale: m.prescribedWeightMale ? Number(m.prescribedWeightMale) : null,
      prescribedWeightFemale: m.prescribedWeightFemale ? Number(m.prescribedWeightFemale) : null,
      rxStandard: m.rxStandard,
    })),
  }));

  return NextResponse.json(result);
}

// POST /api/admin/benchmarks — create a benchmark (admin can create system benchmarks)
export async function POST(req: NextRequest) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const {
    name,
    description,
    workoutType,
    timeCapSeconds,
    amrapDurationSeconds,
    repScheme,
    isSystem,
    movements: movementsList,
  } = body;

  const trimmedName = name?.trim();
  if (!trimmedName) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (!workoutType) {
    return NextResponse.json({ error: "Workout type is required" }, { status: 400 });
  }

  const result = await db.transaction(async (tx) => {
    const [bw] = await tx
      .insert(benchmarkWorkouts)
      .values({
        name: trimmedName,
        description: description || null,
        workoutType,
        timeCapSeconds: timeCapSeconds || null,
        amrapDurationSeconds: amrapDurationSeconds || null,
        repScheme: repScheme || null,
        createdBy: isSystem ? null : user.id,
        isSystem: isSystem ?? false,
      })
      .returning();

    if (Array.isArray(movementsList) && movementsList.length > 0) {
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
            benchmarkWorkoutId: bw.id,
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

    return bw;
  });

  return NextResponse.json(result, { status: 201 });
}
