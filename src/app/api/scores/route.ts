import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scores, workouts } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// GET /api/scores — list user's scores
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workoutId = req.nextUrl.searchParams.get("workoutId");

  const rows = workoutId
    ? await db
        .select()
        .from(scores)
        .where(eq(scores.workoutId, workoutId))
        .orderBy(desc(scores.createdAt))
    : await db
        .select({
          id: scores.id,
          workoutId: scores.workoutId,
          division: scores.division,
          timeSeconds: scores.timeSeconds,
          rounds: scores.rounds,
          remainderReps: scores.remainderReps,
          weightLbs: scores.weightLbs,
          totalReps: scores.totalReps,
          scoreText: scores.scoreText,
          hitTimeCap: scores.hitTimeCap,
          notes: scores.notes,
          rpe: scores.rpe,
          createdAt: scores.createdAt,
          workoutTitle: workouts.title,
          workoutType: workouts.workoutType,
          workoutDate: workouts.workoutDate,
        })
        .from(scores)
        .innerJoin(workouts, eq(workouts.id, scores.workoutId))
        .where(eq(scores.userId, user.id))
        .orderBy(desc(scores.createdAt))
        .limit(50);

  return NextResponse.json(rows);
}

// POST /api/scores — log a score
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { workoutId, division } = body;

  if (!workoutId || !division) {
    return NextResponse.json({ error: "workoutId and division are required" }, { status: 400 });
  }

  try {
    const [score] = await db
      .insert(scores)
      .values({
        workoutId,
        userId: user.id,
        division,
        timeSeconds: body.timeSeconds || null,
        rounds: body.rounds || null,
        remainderReps: body.remainderReps || null,
        weightLbs: body.weightLbs || null,
        totalReps: body.totalReps || null,
        scoreText: body.scoreText || null,
        hitTimeCap: body.hitTimeCap ?? false,
        notes: body.notes || null,
        rpe: body.rpe || null,
      })
      .returning();

    return NextResponse.json(score, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("unique") || message.includes("duplicate")) {
      return NextResponse.json({ error: "Score already logged for this workout" }, { status: 409 });
    }
    throw err;
  }
}
