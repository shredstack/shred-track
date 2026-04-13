import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { workouts, benchmarkWorkouts, benchmarkWorkoutMovements, movements } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// GET /api/workouts — list workouts (optionally filtered by communityId)
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const communityId = req.nextUrl.searchParams.get("communityId");

  const rows = communityId
    ? await db
        .select()
        .from(workouts)
        .where(eq(workouts.communityId, communityId))
        .orderBy(desc(workouts.workoutDate))
        .limit(50)
    : await db
        .select()
        .from(workouts)
        .where(eq(workouts.createdBy, user.id))
        .orderBy(desc(workouts.workoutDate))
        .limit(50);

  return NextResponse.json(rows);
}

// POST /api/workouts — create a workout
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const {
    title,
    description,
    rawText,
    workoutType,
    timeCapSeconds,
    amrapDurationSeconds,
    repScheme,
    workoutDate,
    communityId,
    published,
    source,
    benchmarkWorkoutId,
    movements: movementsList,
  } = body;

  // When creating from a benchmark, copy fields from the benchmark definition
  if (benchmarkWorkoutId) {
    const [benchmark] = await db
      .select()
      .from(benchmarkWorkouts)
      .where(eq(benchmarkWorkouts.id, benchmarkWorkoutId))
      .limit(1);

    if (!benchmark) {
      return NextResponse.json({ error: "Benchmark not found" }, { status: 404 });
    }

    // Get benchmark movements
    const bmMovements = await db
      .select({
        movementId: benchmarkWorkoutMovements.movementId,
        orderIndex: benchmarkWorkoutMovements.orderIndex,
        prescribedReps: benchmarkWorkoutMovements.prescribedReps,
        prescribedWeightMale: benchmarkWorkoutMovements.prescribedWeightMale,
        prescribedWeightFemale: benchmarkWorkoutMovements.prescribedWeightFemale,
        rxStandard: benchmarkWorkoutMovements.rxStandard,
        notes: benchmarkWorkoutMovements.notes,
      })
      .from(benchmarkWorkoutMovements)
      .where(eq(benchmarkWorkoutMovements.benchmarkWorkoutId, benchmarkWorkoutId))
      .orderBy(benchmarkWorkoutMovements.orderIndex);

    if (!workoutDate) {
      return NextResponse.json({ error: "workoutDate is required" }, { status: 400 });
    }

    const { workoutMovements } = await import("@/db/schema");

    const [workout] = await db
      .insert(workouts)
      .values({
        createdBy: user.id,
        communityId: communityId || null,
        title: benchmark.name,
        description: benchmark.description,
        workoutType: benchmark.workoutType,
        timeCapSeconds: benchmark.timeCapSeconds,
        amrapDurationSeconds: benchmark.amrapDurationSeconds,
        repScheme: benchmark.repScheme,
        workoutDate,
        published: published ?? false,
        source: "benchmark",
        benchmarkWorkoutId,
      })
      .returning();

    if (bmMovements.length > 0) {
      await db.insert(workoutMovements).values(
        bmMovements.map((m) => ({
          workoutId: workout.id,
          movementId: m.movementId,
          orderIndex: m.orderIndex,
          prescribedReps: m.prescribedReps,
          prescribedWeightMale: m.prescribedWeightMale,
          prescribedWeightFemale: m.prescribedWeightFemale,
          rxStandard: m.rxStandard,
          notes: m.notes,
        }))
      );
    }

    return NextResponse.json(workout, { status: 201 });
  }

  if (!workoutType || !workoutDate) {
    return NextResponse.json({ error: "workoutType and workoutDate are required" }, { status: 400 });
  }

  const [workout] = await db
    .insert(workouts)
    .values({
      createdBy: user.id,
      communityId: communityId || null,
      title: title || null,
      description: description || null,
      rawText: rawText || null,
      workoutType,
      timeCapSeconds: timeCapSeconds || null,
      amrapDurationSeconds: amrapDurationSeconds || null,
      repScheme: repScheme || null,
      workoutDate,
      published: published ?? false,
      source: source || "manual",
    })
    .returning();

  // If movements were provided, insert them
  if (Array.isArray(movementsList) && movementsList.length > 0) {
    const { workoutMovements } = await import("@/db/schema");
    await db.insert(workoutMovements).values(
      movementsList.map((m: { movementId: string; orderIndex: number; prescribedReps?: string; prescribedWeightMale?: string; prescribedWeightFemale?: string; rxStandard?: string; notes?: string }, i: number) => ({
        workoutId: workout.id,
        movementId: m.movementId,
        orderIndex: m.orderIndex ?? i,
        prescribedReps: m.prescribedReps || null,
        prescribedWeightMale: m.prescribedWeightMale || null,
        prescribedWeightFemale: m.prescribedWeightFemale || null,
        rxStandard: m.rxStandard || null,
        notes: m.notes || null,
      }))
    );
  }

  return NextResponse.json(workout, { status: 201 });
}
