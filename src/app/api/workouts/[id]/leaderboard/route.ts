// GET /api/workouts/[id]/leaderboard
//
// Returns Record<crossfitWorkoutPartId, LeaderboardEntry[]> for every
// part of the workout, scoped to active members of the gym. Personal
// sessions return 403.
//
// Unified-schema: `id` is a workout_sessions.id. The session points at a
// template; we pull leaderboard entries for every score whose
// workoutSessionId is in the SAME day's session set (so a member who
// logged the same Murph independently still shows up alongside the gym
// programming card's scores). The legacy reader only looked at scores
// against the single workout row; the new shape includes any session
// referencing the same template on the same date.

import { NextRequest, NextResponse } from "next/server";
import { aliasedTable, and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  communityMemberships,
  crossfitWorkoutMovements,
  crossfitWorkoutParts,
  movements,
  scoreMovementDetails,
  scoreReactions,
  scores,
  users,
  workoutSessions,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { getSessionAccess } from "@/lib/authz/workout";
import { formatBestScore } from "@/lib/crossfit/benchmark-stats";
import type {
  LeaderboardEntry,
  RoundScoreAggregation,
  WorkoutType,
} from "@/types/crossfit";

const substitutionMovements = aliasedTable(movements, "subs");

function computeSortValue(
  workoutType: WorkoutType,
  row: {
    timeSeconds: number | null;
    totalReps: number | null;
    rounds: number | null;
    remainderReps: number | null;
    weightLbs: number | null;
    hitTimeCap: boolean;
    // Set per-score when the part has at least one athlete-weight movement.
    heaviestAthleteWeightLb?: number | null;
    // The part's effective scoreType. 'load' flips ambiguous workout types
    // (for_reps/amrap/intervals) to rank by heaviest weight instead of reps.
    partScoreType?: "reps" | "load" | null;
  }
): number {
  // Athlete-picked weight + scoreType === "load": rank by heaviest weight
  // across rounds. Branches BEFORE the legacy switch so existing rows
  // (partScoreType undefined / null) hit the same code path they did
  // before this feature shipped — no regression possible.
  if (row.partScoreType === "load") {
    // Score has no logged weight (athlete left it blank) — rank at the
    // bottom rather than falling through to e.g. totalReps for a for_reps
    // part, which would let weightless entries outrank heavier ones.
    return row.heaviestAthleteWeightLb ?? 0;
  }
  switch (workoutType) {
    case "for_time":
      return row.timeSeconds ?? Number.POSITIVE_INFINITY;
    case "timed_rounds":
      // scores.timeSeconds is the pre-computed aggregate (slowest /
      // fastest / sum / average). Lower wins, same as for_time.
      return row.timeSeconds ?? Number.POSITIVE_INFINITY;
    case "amrap": {
      if (row.totalReps != null) return row.totalReps;
      return (row.rounds ?? 0) * 1000 + (row.remainderReps ?? 0);
    }
    case "emom": {
      // Load mode is handled by the scoreType === "load" branch above. Reps
      // mode ranks by total reps; rounds mode by rounds + remainder (same
      // encoding as AMRAP); note mode has no numeric key → 0.
      if (row.totalReps != null) return row.totalReps;
      return (row.rounds ?? 0) * 1000 + (row.remainderReps ?? 0);
    }
    case "for_load":
    case "max_effort":
      return row.weightLbs ?? 0;
    case "for_reps":
    case "for_calories":
    case "tabata":
      return row.totalReps ?? 0;
    default:
      return row.totalReps ?? row.weightLbs ?? row.timeSeconds ?? 0;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: sessionId } = await params;

  const access = await getSessionAccess(user.id, sessionId);
  if (!access.exists) {
    return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  }
  if (!access.canRead) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!access.isGymSession || !access.communityId) {
    return NextResponse.json(
      { error: "Leaderboards are only available for gym workouts" },
      { status: 403 }
    );
  }

  // Resolve the session's template id; if there's no template (freeform
  // session), there can't be parts to score against.
  const [s] = await db
    .select({
      crossfitWorkoutId: workoutSessions.crossfitWorkoutId,
      workoutDate: workoutSessions.workoutDate,
    })
    .from(workoutSessions)
    .where(eq(workoutSessions.id, sessionId))
    .limit(1);
  if (!s?.crossfitWorkoutId) {
    return NextResponse.json({ parts: {} });
  }

  // Pull the template's parts. Leaderboard buckets keyed by part id.
  const parts = await db
    .select({
      id: crossfitWorkoutParts.id,
      workoutType: crossfitWorkoutParts.workoutType,
      scoreType: crossfitWorkoutParts.scoreType,
      roundScoreAggregation: crossfitWorkoutParts.roundScoreAggregation,
    })
    .from(crossfitWorkoutParts)
    .where(eq(crossfitWorkoutParts.crossfitWorkoutId, s.crossfitWorkoutId))
    .orderBy(crossfitWorkoutParts.orderIndex);
  if (parts.length === 0) {
    return NextResponse.json({ parts: {} });
  }
  const partTypeById = new Map<string, WorkoutType>(
    parts.map((p) => [p.id, p.workoutType as WorkoutType])
  );
  const partScoreTypeById = new Map<string, "reps" | "load" | null>(
    parts.map((p) => [p.id, (p.scoreType as "reps" | "load" | null) ?? null])
  );
  const partRoundAggregationById = new Map<
    string,
    RoundScoreAggregation | null
  >(
    parts.map((p) => [
      p.id,
      (p.roundScoreAggregation as RoundScoreAggregation | null) ?? null,
    ])
  );
  const partIds = parts.map((p) => p.id);

  // Which parts have at least one athlete-weight movement? Drives whether
  // we emit `heaviestAthleteWeightLb` on entries (and whether the sort
  // branch can fire).
  const athleteWeightPartRows = partIds.length
    ? await db
        .select({
          crossfitWorkoutPartId: crossfitWorkoutMovements.crossfitWorkoutPartId,
        })
        .from(crossfitWorkoutMovements)
        .where(
          and(
            inArray(crossfitWorkoutMovements.crossfitWorkoutPartId, partIds),
            eq(crossfitWorkoutMovements.weightSource, "athlete")
          )
        )
    : [];
  const partHasAthleteWeight = new Set<string>(
    athleteWeightPartRows
      .map((r) => r.crossfitWorkoutPartId)
      .filter((id): id is string => !!id)
  );
  // Load-scored EMOMs rank by the heaviest per-interval weight even when the
  // movement wasn't explicitly flagged athlete-weight — the "Score by: Load"
  // picker is the signal. Treat them like athlete-weight parts so the
  // heaviest-weight sort branch (and chip) fires.
  for (const p of parts) {
    if (p.workoutType === "emom" && (p.scoreType ?? null) === "load") {
      partHasAthleteWeight.add(p.id);
    }
  }

  // Sessions to include in the leaderboard: every session at this gym on
  // this date. We deliberately do NOT filter by crossfit_workout_id here
  // — scores are scoped to the template via crossfit_workout_part_id
  // (a unique key onto a single template), not via the session they're
  // attached to. The session is just a date+gym anchor.
  //
  // Why this matters: on multi-section days the score row's
  // workout_session_id can point at the day-group's lead session (often
  // the warm_up, no template) instead of the WOD section's own session
  // — both legacy scores logged before the section-scoped fix and the
  // synthetic-group semantics referenced in scores/[id]/route.ts. The
  // partId filter on the scores query below is the canonical attribution.
  const peerSessions = await db
    .select({ id: workoutSessions.id })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.communityId, access.communityId),
        eq(workoutSessions.workoutDate, s.workoutDate)
      )
    );
  const sessionIds = peerSessions.map((p) => p.id);
  if (sessionIds.length === 0) {
    const empty: Record<string, LeaderboardEntry[]> = {};
    for (const p of parts) empty[p.id] = [];
    return NextResponse.json({ parts: empty });
  }

  const rows = await db
    .select({
      scoreId: scores.id,
      crossfitWorkoutPartId: scores.crossfitWorkoutPartId,
      userId: scores.userId,
      userName: users.name,
      userUsername: users.username,
      userImage: users.image,
      division: scores.division,
      timeSeconds: scores.timeSeconds,
      rounds: scores.rounds,
      remainderReps: scores.remainderReps,
      weightLbs: scores.weightLbs,
      totalReps: scores.totalReps,
      scoreText: scores.scoreText,
      hitTimeCap: scores.hitTimeCap,
      rpe: scores.rpe,
      notes: scores.notes,
      reactionCount: scores.reactionCount,
      commentCount: scores.commentCount,
      createdAt: scores.createdAt,
      viewerReacted: sql<boolean>`EXISTS (
        SELECT 1 FROM ${scoreReactions}
        WHERE ${scoreReactions.scoreId} = ${scores.id}
          AND ${scoreReactions.userId} = ${user.id}
      )`,
    })
    .from(scores)
    .innerJoin(users, eq(users.id, scores.userId))
    .where(
      and(
        inArray(scores.workoutSessionId, sessionIds),
        inArray(scores.crossfitWorkoutPartId, partIds),
        eq(users.isShadow, false)
      )
    );

  if (rows.length === 0) {
    const empty: Record<string, LeaderboardEntry[]> = {};
    for (const p of parts) empty[p.id] = [];
    return NextResponse.json({ parts: empty });
  }

  // Active membership filter — stops deactivated members' scores from
  // haunting the leaderboard.
  const activeMembers = await db
    .select({ userId: communityMemberships.userId })
    .from(communityMemberships)
    .where(
      and(
        eq(communityMemberships.communityId, access.communityId),
        eq(communityMemberships.isActive, true)
      )
    );
  const activeIds = new Set(activeMembers.map((m) => m.userId));
  const liveRows = rows.filter((r) => activeIds.has(r.userId));

  // Scaling details — join through crossfit_workout_movements now.
  const scoreIds = liveRows.map((r) => r.scoreId);
  type ScalingDetail = {
    scoreId: string;
    workoutMovementId: string;
    movementName: string;
    wasRx: boolean;
    actualWeight: string | null;
    actualReps: string | null;
    modification: string | null;
    substitutionName: string | null;
    actualWeightLbsPerRound: string[] | null;
  };
  let scalingDetails: ScalingDetail[] = [];
  if (scoreIds.length > 0) {
    scalingDetails = await db
      .select({
        scoreId: scoreMovementDetails.scoreId,
        workoutMovementId: crossfitWorkoutMovements.id,
        movementName: movements.canonicalName,
        wasRx: scoreMovementDetails.wasRx,
        actualWeight: scoreMovementDetails.actualWeight,
        actualReps: scoreMovementDetails.actualReps,
        modification: scoreMovementDetails.modification,
        substitutionName: substitutionMovements.canonicalName,
        actualWeightLbsPerRound: scoreMovementDetails.actualWeightLbsPerRound,
      })
      .from(scoreMovementDetails)
      .innerJoin(
        crossfitWorkoutMovements,
        eq(
          crossfitWorkoutMovements.id,
          scoreMovementDetails.crossfitWorkoutMovementId
        )
      )
      .innerJoin(
        movements,
        eq(movements.id, crossfitWorkoutMovements.movementId)
      )
      .leftJoin(
        substitutionMovements,
        eq(
          substitutionMovements.id,
          scoreMovementDetails.substitutionMovementId
        )
      )
      .where(inArray(scoreMovementDetails.scoreId, scoreIds));
  }

  const detailsByScore = new Map<
    string,
    LeaderboardEntry["scalingDetails"]
  >();
  // Heaviest weight (lb) per score across all athlete-weight occurrences.
  // Drizzle returns numeric[] as string[] — coerce inline.
  const heaviestWeightByScore = new Map<string, number>();
  for (const d of scalingDetails) {
    const list = detailsByScore.get(d.scoreId) ?? [];
    list.push({
      workoutMovementId: d.workoutMovementId,
      movementName: d.movementName,
      wasRx: d.wasRx,
      actualWeight: d.actualWeight ?? undefined,
      actualReps: d.actualReps ?? undefined,
      modification: d.modification ?? undefined,
      substitutionName: d.substitutionName ?? undefined,
    });
    detailsByScore.set(d.scoreId, list);
    if (
      Array.isArray(d.actualWeightLbsPerRound) &&
      d.actualWeightLbsPerRound.length > 0
    ) {
      const max = d.actualWeightLbsPerRound.reduce((acc, raw) => {
        const n = typeof raw === "number" ? raw : Number(raw);
        return Number.isFinite(n) && n > acc ? n : acc;
      }, 0);
      const prev = heaviestWeightByScore.get(d.scoreId) ?? 0;
      if (max > prev) heaviestWeightByScore.set(d.scoreId, max);
    }
  }

  const result: Record<string, LeaderboardEntry[]> = {};
  for (const p of parts) result[p.id] = [];

  for (const row of liveRows) {
    const partId = row.crossfitWorkoutPartId;
    if (!partId) continue;
    const workoutType = partTypeById.get(partId);
    if (!workoutType) continue;

    const weightLbsNumber =
      row.weightLbs != null ? Number(row.weightLbs) : null;

    const partScoreType = partScoreTypeById.get(partId) ?? null;
    const hasAthleteWeight = partHasAthleteWeight.has(partId);
    const heaviestAthleteWeightLb = hasAthleteWeight
      ? heaviestWeightByScore.get(row.scoreId) ?? null
      : null;

    const displayScore = formatBestScore(
      workoutType,
      {
        scoreId: row.scoreId,
        sessionId: sessionId,
        workoutDate: "",
        division: row.division,
        timeSeconds: row.timeSeconds,
        rounds: row.rounds,
        remainderReps: row.remainderReps,
        weightLbs: weightLbsNumber,
        totalReps: row.totalReps,
        scoreText: row.scoreText,
        hitTimeCap: row.hitTimeCap,
        createdAt: row.createdAt.toISOString(),
      },
      partScoreType,
      heaviestAthleteWeightLb,
      partRoundAggregationById.get(partId) ?? null
    );

    const sortValue = computeSortValue(workoutType, {
      timeSeconds: row.timeSeconds,
      totalReps: row.totalReps,
      rounds: row.rounds,
      remainderReps: row.remainderReps,
      weightLbs: weightLbsNumber,
      hitTimeCap: row.hitTimeCap,
      heaviestAthleteWeightLb,
      partScoreType,
    });

    // Chip emission: only when scoreType !== 'load' (otherwise the displayScore
    // already shows the weight — chip would duplicate it). Athlete-weight
    // movements MUST be present, else the chip is meaningless.
    const chipWeight =
      hasAthleteWeight && partScoreType !== "load"
        ? heaviestAthleteWeightLb
        : null;

    const entry: LeaderboardEntry = {
      scoreId: row.scoreId,
      userId: row.userId,
      userName: row.userName,
      userUsername: row.userUsername,
      userImage: row.userImage,
      division: row.division as LeaderboardEntry["division"],
      displayScore,
      sortValue,
      timeSeconds: row.timeSeconds ?? undefined,
      rounds: row.rounds ?? undefined,
      remainderReps: row.remainderReps ?? undefined,
      weightLbs: row.weightLbs ?? undefined,
      totalReps: row.totalReps ?? undefined,
      scoreText: row.scoreText ?? undefined,
      hitTimeCap: row.hitTimeCap,
      rpe: row.rpe ?? undefined,
      notes: row.notes ?? undefined,
      scalingDetails: detailsByScore.get(row.scoreId),
      heaviestAthleteWeightLb: chipWeight,
      reactionCount: row.reactionCount,
      commentCount: row.commentCount,
      viewerReacted: !!row.viewerReacted,
      createdAt: row.createdAt.toISOString(),
    };

    result[partId].push(entry);
  }

  return NextResponse.json({ parts: result });
}
