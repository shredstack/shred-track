// GET /api/benchmarks/[id]/history — full attempt history for the user
// against a benchmark template. One-predicate join in the unified schema:
// scores → workout_sessions WHERE session.crossfit_workout_id = $id.
// The legacy reader had to UNION across workouts.benchmark_workout_id and
// workout_sections.benchmark_workout_id; both collapse to a single FK now.
//
// For weightlifting benchmarks the response is a `repMaxHistory` shape
// with one variant per rep target {1, 2, 3, 5}, including for_load
// attempts that weren't auto-linked at write time (history rolls up via
// the anchor movement, not the FK).

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  crossfitWorkoutMovements,
  crossfitWorkoutParts,
  crossfitWorkouts,
  movements,
  scores,
  workoutSessions,
} from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { pickBestScore, type ScoreRow } from "@/lib/crossfit/benchmark-stats";
import {
  inferRepMaxTarget,
  REP_MAX_TARGETS,
} from "@/lib/crossfit/weightlifting-benchmarks";
import type {
  BenchmarkAttempt,
  RepMaxTarget,
  WorkoutType,
} from "@/types/crossfit";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const [bw] = await db
    .select({
      id: crossfitWorkouts.id,
      name: crossfitWorkouts.title,
      workoutType: crossfitWorkouts.workoutType,
      weightliftingMovementId: crossfitWorkouts.weightliftingMovementId,
    })
    .from(crossfitWorkouts)
    .where(eq(crossfitWorkouts.id, id))
    .limit(1);

  if (!bw) {
    return NextResponse.json({ error: "Benchmark not found" }, { status: 404 });
  }

  if (bw.weightliftingMovementId) {
    return weightliftingHistory(
      user.id,
      bw.id,
      bw.name,
      bw.workoutType,
      bw.weightliftingMovementId
    );
  }

  // Non-weightlifting branch: join scores → sessions where
  // session.crossfit_workout_id = $id.
  const rows = await db
    .select({
      scoreId: scores.id,
      sessionId: scores.workoutSessionId,
      workoutDate: workoutSessions.workoutDate,
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
    .innerJoin(workoutSessions, eq(workoutSessions.id, scores.workoutSessionId))
    .where(
      and(
        eq(scores.userId, user.id),
        eq(workoutSessions.crossfitWorkoutId, id)
      )
    )
    .orderBy(desc(workoutSessions.workoutDate), desc(scores.createdAt));

  const normalized: ScoreRow[] = rows.map((r) => ({
    scoreId: r.scoreId,
    workoutId: r.sessionId,
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
    workoutId: r.sessionId,
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

async function weightliftingHistory(
  userId: string,
  benchmarkId: string,
  benchmarkName: string,
  workoutType: string,
  movementId: string
) {
  // Pull every for_load score whose part references this movement,
  // regardless of which template the session points at (auto-link or
  // user-created). The join goes through crossfit_workout_parts so we
  // get the part-level repScheme + movement-level prescribedReps for
  // classification.
  const rows = await db
    .select({
      scoreId: scores.id,
      sessionId: scores.workoutSessionId,
      workoutDate: workoutSessions.workoutDate,
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
      partRepScheme: crossfitWorkoutParts.repScheme,
      movementPrescribedReps: crossfitWorkoutMovements.prescribedReps,
    })
    .from(scores)
    .innerJoin(workoutSessions, eq(workoutSessions.id, scores.workoutSessionId))
    .innerJoin(
      crossfitWorkoutParts,
      eq(crossfitWorkoutParts.id, scores.crossfitWorkoutPartId)
    )
    .innerJoin(
      crossfitWorkoutMovements,
      eq(crossfitWorkoutMovements.crossfitWorkoutPartId, crossfitWorkoutParts.id)
    )
    .where(
      and(
        eq(scores.userId, userId),
        eq(crossfitWorkoutParts.workoutType, "for_load"),
        eq(crossfitWorkoutMovements.movementId, movementId)
      )
    )
    .orderBy(desc(workoutSessions.workoutDate), desc(scores.createdAt));

  const [mv] = await db
    .select({ canonicalName: movements.canonicalName })
    .from(movements)
    .where(eq(movements.id, movementId))
    .limit(1);
  const movementName = mv?.canonicalName ?? benchmarkName;

  const buckets = new Map<RepMaxTarget, BenchmarkAttempt[]>();
  for (const r of rows) {
    const target = inferRepMaxTarget(
      r.movementPrescribedReps ?? r.partRepScheme ?? null
    );
    if (!target) continue;
    const list = buckets.get(target) ?? [];
    list.push({
      scoreId: r.scoreId,
      workoutId: r.sessionId,
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
      isPR: false,
    });
    buckets.set(target, list);
  }

  const variants = REP_MAX_TARGETS.map((target) => {
    const attempts = buckets.get(target) ?? [];
    let prAttempt: BenchmarkAttempt | null = null;
    for (const a of attempts) {
      if (a.weightLbs == null) continue;
      if (
        !prAttempt ||
        a.weightLbs > (prAttempt.weightLbs ?? -Infinity) ||
        (a.weightLbs === prAttempt.weightLbs &&
          a.workoutDate < prAttempt.workoutDate)
      ) {
        prAttempt = a;
      }
    }
    if (prAttempt) prAttempt.isPR = true;
    return {
      repTarget: target,
      attempts,
      pr:
        prAttempt && prAttempt.weightLbs != null
          ? {
              weightLbs: prAttempt.weightLbs,
              workoutDate: prAttempt.workoutDate,
              scoreId: prAttempt.scoreId,
            }
          : null,
    };
  });

  return NextResponse.json({
    benchmarkId,
    benchmarkName,
    workoutType,
    repMaxHistory: {
      movementId,
      movementName,
      variants,
    },
  });
}
