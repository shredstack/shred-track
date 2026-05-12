import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  benchmarkWorkouts,
  movements,
  scores,
  workoutMovements,
  workoutParts,
  workouts,
} from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { pickBestScore, type ScoreRow } from "@/lib/crossfit/benchmark-stats";
import {
  inferRepMaxTarget,
  REP_MAX_TARGETS,
} from "@/lib/crossfit/weightlifting-benchmarks";
import type {
  RepMaxTarget,
  WorkoutType,
} from "@/types/crossfit";

// GET /api/benchmarks/[id]/history — full attempt history for the user against a benchmark.
//
// For weightlifting benchmarks (where the row carries a
// `weightliftingMovementId`), the response is a `repMaxHistory` shape with
// one variant per rep target (1, 2, 3, 5). The variants include the full
// for_load history against the movement — even attempts that weren't
// auto-linked at write time. The discriminator is `repMaxHistory in result`.
//
// For everything else (Girls, Heroes, Open, gym benchmarks, custom user
// benchmarks), the response keeps the legacy flat `attempts` shape.
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
      weightliftingMovementId: benchmarkWorkouts.weightliftingMovementId,
    })
    .from(benchmarkWorkouts)
    .where(eq(benchmarkWorkouts.id, id))
    .limit(1);

  if (!bw) {
    return NextResponse.json({ error: "Benchmark not found" }, { status: 404 });
  }

  if (bw.weightliftingMovementId) {
    return weightliftingHistory(user.id, bw.id, bw.name, bw.workoutType, bw.weightliftingMovementId);
  }

  // Legacy flat-history path.
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

// ---------------------------------------------------------------------------
// Weightlifting branch
// ---------------------------------------------------------------------------

async function weightliftingHistory(
  userId: string,
  benchmarkId: string,
  benchmarkName: string,
  workoutType: string,
  movementId: string
) {
  // Pull every for_load score the user has logged whose part contains this
  // movement. Includes attempts that weren't auto-linked at write time.
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
      partRepScheme: workoutParts.repScheme,
    })
    .from(scores)
    .innerJoin(workouts, eq(workouts.id, scores.workoutId))
    .innerJoin(workoutParts, eq(workoutParts.id, scores.workoutPartId))
    .innerJoin(
      workoutMovements,
      eq(workoutMovements.workoutPartId, workoutParts.id)
    )
    .where(
      and(
        eq(scores.userId, userId),
        eq(workoutParts.workoutType, "for_load"),
        eq(workoutMovements.movementId, movementId)
      )
    )
    .orderBy(desc(workouts.workoutDate), desc(scores.createdAt));

  // Resolve the canonical movement name once for the response.
  const [mv] = await db
    .select({ canonicalName: movements.canonicalName })
    .from(movements)
    .where(eq(movements.id, movementId))
    .limit(1);
  const movementName = mv?.canonicalName ?? benchmarkName;

  // Bucket by rep target. Drop rows where the rep scheme doesn't classify
  // to {1, 2, 3, 5} — those can't be attributed to any tab.
  type Attempt = {
    scoreId: string;
    workoutId: string;
    workoutDate: string;
    division: string;
    timeSeconds: number | null;
    rounds: number | null;
    remainderReps: number | null;
    weightLbs: number | null;
    totalReps: number | null;
    scoreText: string | null;
    hitTimeCap: boolean;
    notes: string | null;
    createdAt: string;
    isPR: boolean;
  };
  const buckets = new Map<RepMaxTarget, Attempt[]>();
  for (const r of rows) {
    const target = inferRepMaxTarget(r.partRepScheme ?? null);
    if (!target) continue;
    const list = buckets.get(target) ?? [];
    list.push({
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
      isPR: false,
    });
    buckets.set(target, list);
  }

  // Per-target PR detection. Heaviest weight wins; ties broken by older
  // workoutDate so the PR points at the original lift.
  const variants = REP_MAX_TARGETS.map((target) => {
    const attempts = buckets.get(target) ?? [];
    let prAttempt: Attempt | null = null;
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
