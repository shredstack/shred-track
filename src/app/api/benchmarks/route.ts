import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { benchmarkWorkouts, benchmarkWorkoutMovements, movements, communityMemberships } from "@/db/schema";
import { eq, and, or, ilike, inArray } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// GET /api/benchmarks — list benchmarks visible to the user
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const search = req.nextUrl.searchParams.get("search");
  const category = req.nextUrl.searchParams.get("category");
  const communityId = req.nextUrl.searchParams.get("communityId");

  // Build conditions for which benchmarks are visible
  const conditions = [];

  if (category === "system") {
    conditions.push(eq(benchmarkWorkouts.isSystem, true));
  } else if (category === "custom") {
    conditions.push(
      and(
        eq(benchmarkWorkouts.createdBy, user.id),
        eq(benchmarkWorkouts.isSystem, false)
      )!
    );
  } else if (category === "community" && communityId) {
    conditions.push(eq(benchmarkWorkouts.communityId, communityId));
  } else {
    // Default: show system + user's own + user's communities
    const userCommunities = await db
      .select({ communityId: communityMemberships.communityId })
      .from(communityMemberships)
      .where(eq(communityMemberships.userId, user.id));

    const communityIds = userCommunities.map((c) => c.communityId);

    const visibilityConditions = [
      eq(benchmarkWorkouts.isSystem, true),
      eq(benchmarkWorkouts.createdBy, user.id),
    ];

    if (communityIds.length > 0) {
      visibilityConditions.push(
        inArray(benchmarkWorkouts.communityId, communityIds)
      );
    }

    conditions.push(or(...visibilityConditions)!);
  }

  // Add search filter
  if (search) {
    conditions.push(ilike(benchmarkWorkouts.name, `%${search}%`));
  }

  const rows = await db
    .select()
    .from(benchmarkWorkouts)
    .where(and(...conditions))
    .orderBy(benchmarkWorkouts.name);

  // Fetch movements for each benchmark
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

  // Group movements by benchmark
  const movementsByBenchmark = new Map<string, typeof allMovements>();
  for (const m of allMovements) {
    const list = movementsByBenchmark.get(m.benchmarkWorkoutId) || [];
    list.push(m);
    movementsByBenchmark.set(m.benchmarkWorkoutId, list);
  }

  const result = rows.map((bw) => ({
    id: bw.id,
    name: bw.name,
    description: bw.description,
    workoutType: bw.workoutType,
    timeCapSeconds: bw.timeCapSeconds,
    amrapDurationSeconds: bw.amrapDurationSeconds,
    repScheme: bw.repScheme,
    isSystem: bw.isSystem,
    createdBy: bw.createdBy,
    communityId: bw.communityId,
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

// POST /api/benchmarks — create a user or community benchmark
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const {
    name,
    description,
    workoutType,
    timeCapSeconds,
    amrapDurationSeconds,
    repScheme,
    communityId,
    movements: movementsList,
  } = body;

  // Validation
  const trimmedName = name?.trim();
  if (!trimmedName || trimmedName.length > 100) {
    return NextResponse.json({ error: "Name is required (max 100 characters)" }, { status: 400 });
  }

  if (!workoutType) {
    return NextResponse.json({ error: "Workout type is required" }, { status: 400 });
  }

  if (!Array.isArray(movementsList) || movementsList.length === 0) {
    return NextResponse.json({ error: "At least one movement is required" }, { status: 400 });
  }

  // Check name doesn't conflict with system benchmarks
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

  // Check user uniqueness
  if (!communityId) {
    const userConflict = await db
      .select({ id: benchmarkWorkouts.id })
      .from(benchmarkWorkouts)
      .where(
        and(
          eq(benchmarkWorkouts.createdBy, user.id),
          eq(benchmarkWorkouts.name, trimmedName),
          eq(benchmarkWorkouts.isSystem, false)
        )
      )
      .limit(1);

    if (userConflict.length > 0) {
      return NextResponse.json(
        { error: "You already have a benchmark with this name" },
        { status: 409 }
      );
    }
  }

  // Create benchmark + movements in a transaction
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
        createdBy: user.id,
        communityId: communityId || null,
        isSystem: false,
      })
      .returning();

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

    return bw;
  });

  return NextResponse.json(result, { status: 201 });
}
