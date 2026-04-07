import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { workouts } from "@/db/schema";
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
    movements: movementsList,
  } = body;

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
