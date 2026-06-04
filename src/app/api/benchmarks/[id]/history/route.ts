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
  scoreMovementDetails,
  scores,
  workoutSessions,
} from "@/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { pickBestScore, type ScoreRow } from "@/lib/crossfit/benchmark-stats";
import {
  classifyRepMaxSets,
  REP_MAX_TARGETS,
} from "@/lib/crossfit/weightlifting-benchmarks";
import { normalizeSetEntries } from "@/lib/crossfit/set-entries";
import type {
  BenchmarkAttempt,
  BenchmarkPartAttempt,
  BenchmarkPartInfo,
  BenchmarkSession,
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

  // Non-weightlifting branch: pull every part of the benchmark, then
  // every score logged against any of those parts. Group by session so a
  // multi-part WOD shows up as one attempt with multiple part scores,
  // not N separate attempts (one per part) that all look identical.
  const partRows = await db
    .select({
      id: crossfitWorkoutParts.id,
      label: crossfitWorkoutParts.label,
      orderIndex: crossfitWorkoutParts.orderIndex,
      workoutType: crossfitWorkoutParts.workoutType,
    })
    .from(crossfitWorkoutParts)
    .where(eq(crossfitWorkoutParts.crossfitWorkoutId, id))
    .orderBy(asc(crossfitWorkoutParts.orderIndex));

  const parts: BenchmarkPartInfo[] = partRows.map((p) => ({
    id: p.id,
    label: p.label,
    orderIndex: p.orderIndex,
    workoutType: p.workoutType as WorkoutType,
  }));

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
      partId: crossfitWorkoutParts.id,
      partLabel: crossfitWorkoutParts.label,
      partOrderIndex: crossfitWorkoutParts.orderIndex,
      partWorkoutType: crossfitWorkoutParts.workoutType,
    })
    .from(scores)
    .innerJoin(workoutSessions, eq(workoutSessions.id, scores.workoutSessionId))
    .innerJoin(
      crossfitWorkoutParts,
      eq(crossfitWorkoutParts.id, scores.crossfitWorkoutPartId)
    )
    .where(
      and(
        eq(scores.userId, user.id),
        eq(workoutSessions.crossfitWorkoutId, id)
      )
    )
    .orderBy(desc(workoutSessions.workoutDate), desc(scores.createdAt));

  // Compute per-part PR. Each part has its own scoring rule
  // (for_load → heaviest, amrap → most reps, etc.) so PRs only make
  // sense within a single part's workoutType.
  const partAttemptIsPR = new Map<string, boolean>(); // scoreId → isPR
  const rowsByPart = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = rowsByPart.get(r.partId) ?? [];
    list.push(r);
    rowsByPart.set(r.partId, list);
  }
  for (const [, partRowList] of rowsByPart) {
    const partType = partRowList[0].partWorkoutType as WorkoutType;
    const normalized: ScoreRow[] = partRowList.map((r) => ({
      scoreId: r.scoreId,
      sessionId: r.sessionId,
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
    const best = pickBestScore(partType, normalized);
    for (const n of normalized) {
      partAttemptIsPR.set(n.scoreId, n === best);
    }
  }

  // Group score rows by sessionId. Sessions come out sorted desc by
  // workout date (rows are already sorted that way and we only key on
  // sessionId, so the first time we see each session is in date order).
  const sessionMap = new Map<string, BenchmarkSession>();
  for (const r of rows) {
    if (!r.sessionId) continue;
    const partAttempt: BenchmarkPartAttempt = {
      partId: r.partId,
      partLabel: r.partLabel,
      partOrderIndex: r.partOrderIndex,
      partWorkoutType: r.partWorkoutType as WorkoutType,
      scoreId: r.scoreId,
      sessionId: r.sessionId,
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
      isPR: partAttemptIsPR.get(r.scoreId) ?? false,
    };
    const existing = sessionMap.get(r.sessionId);
    if (existing) {
      existing.partAttempts.push(partAttempt);
      if (partAttempt.isPR) existing.isPR = true;
    } else {
      sessionMap.set(r.sessionId, {
        sessionId: r.sessionId,
        workoutDate: r.workoutDate,
        division: r.division,
        createdAt: r.createdAt.toISOString(),
        partAttempts: [partAttempt],
        isPR: partAttempt.isPR,
      });
    }
  }

  const sessions = Array.from(sessionMap.values()).map((s) => ({
    ...s,
    partAttempts: [...s.partAttempts].sort(
      (a, b) => a.partOrderIndex - b.partOrderIndex
    ),
  }));

  return NextResponse.json({
    benchmarkId: bw.id,
    benchmarkName: bw.name,
    workoutType: bw.workoutType,
    parts,
    sessions,
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
      setEntries: scoreMovementDetails.setEntries,
      actualWeight: scoreMovementDetails.actualWeight,
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
    .leftJoin(
      scoreMovementDetails,
      and(
        eq(scoreMovementDetails.scoreId, scores.id),
        eq(
          scoreMovementDetails.crossfitWorkoutMovementId,
          crossfitWorkoutMovements.id
        )
      )
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
    const targetWeights = classifyRepMaxSets({
      setEntries: normalizeSetEntries(r.setEntries),
      scoreWeightLbs: r.weightLbs != null ? Number(r.weightLbs) : null,
      actualWeight: r.actualWeight != null ? Number(r.actualWeight) : null,
      movementPrescribedReps: r.movementPrescribedReps,
      partRepScheme: r.partRepScheme,
    });
    for (const [target, weightLbs] of targetWeights) {
      const list = buckets.get(target) ?? [];
      list.push({
        scoreId: r.scoreId,
        sessionId: r.sessionId,
        workoutDate: r.workoutDate,
        division: r.division,
        timeSeconds: r.timeSeconds,
        rounds: r.rounds,
        remainderReps: r.remainderReps,
        weightLbs,
        totalReps: r.totalReps,
        scoreText: r.scoreText,
        hitTimeCap: r.hitTimeCap,
        notes: r.notes,
        createdAt: r.createdAt.toISOString(),
        isPR: false,
      });
      buckets.set(target, list);
    }
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
