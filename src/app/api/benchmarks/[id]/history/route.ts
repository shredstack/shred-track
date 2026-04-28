import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { benchmarkWorkouts, scores, workouts } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { pickBestScore, type ScoreRow } from "@/lib/crossfit/benchmark-stats";
import type { WorkoutType } from "@/types/crossfit";

// GET /api/benchmarks/[id]/history — full attempt history for the user against a benchmark.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const [bw] = await db
    .select({
      id: benchmarkWorkouts.id,
      name: benchmarkWorkouts.name,
      workoutType: benchmarkWorkouts.workoutType,
    })
    .from(benchmarkWorkouts)
    .where(eq(benchmarkWorkouts.id, id))
    .limit(1);

  if (!bw) {
    return NextResponse.json({ error: "Benchmark not found" }, { status: 404 });
  }

  const rows = await db
    .select({
      scoreId: scores.id,
      workoutId: scores.workoutId,
      workoutDate: workouts.workoutDate,
      division: scores.division,
      timeSeconds: scores.timeSeconds,
      rounds: scores.rounds,
      remainderReps: scores.remainderReps,
      weightLbs: scores.weightLbs,
      totalReps: scores.totalReps,
      scoreText: scores.scoreText,
      hitTimeCap: scores.hitTimeCap,
      notes: scores.notes,
      createdAt: scores.createdAt,
    })
    .from(scores)
    .innerJoin(workouts, eq(workouts.id, scores.workoutId))
    .where(
      and(eq(scores.userId, user.id), eq(workouts.benchmarkWorkoutId, id))
    )
    .orderBy(desc(workouts.workoutDate), desc(scores.createdAt));

  const normalized: ScoreRow[] = rows.map((r) => ({
    scoreId: r.scoreId,
    workoutId: r.workoutId,
    workoutDate: r.workoutDate,
    division: r.division,
    timeSeconds: r.timeSeconds,
    rounds: r.rounds,
    remainderReps: r.remainderReps,
    weightLbs: r.weightLbs != null ? Number(r.weightLbs) : null,
    totalReps: r.totalReps,
    scoreText: r.scoreText,
    hitTimeCap: r.hitTimeCap,
    createdAt: r.createdAt.toISOString(),
  }));

  const best = pickBestScore(bw.workoutType as WorkoutType, normalized);

  const attempts = rows.map((r, i) => ({
    scoreId: r.scoreId,
    workoutId: r.workoutId,
    workoutDate: r.workoutDate,
    division: r.division,
    timeSeconds: r.timeSeconds,
    rounds: r.rounds,
    remainderReps: r.remainderReps,
    weightLbs: r.weightLbs != null ? Number(r.weightLbs) : null,
    totalReps: r.totalReps,
    scoreText: r.scoreText,
    hitTimeCap: r.hitTimeCap,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    isPR: normalized[i] === best,
  }));

  return NextResponse.json({
    benchmarkId: bw.id,
    benchmarkName: bw.name,
    workoutType: bw.workoutType,
    attempts,
  });
}
