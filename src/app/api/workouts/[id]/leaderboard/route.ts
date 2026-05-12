import { NextRequest, NextResponse } from "next/server";
import { aliasedTable, and, eq, sql, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  workoutParts,
  scores,
  users,
  scoreReactions,
  communityMemberships,
  scoreMovementDetails,
  workoutMovements,
  movements,
} from "@/db/schema";

const substitutionMovements = aliasedTable(movements, "subs");
import { getSessionUser } from "@/lib/session";
import { getWorkoutAccess } from "@/lib/authz/workout";
import { formatBestScore } from "@/lib/crossfit/benchmark-stats";
import type { LeaderboardEntry, WorkoutType } from "@/types/crossfit";

// Sort value for the leaderboard. The Leaderboard component sorts by
// `sortValue` per the workout type — for_time wants ascending, everything
// else descending. We pre-compute one number per row so the client only
// has to sort numbers.
function computeSortValue(
  workoutType: WorkoutType,
  row: {
    timeSeconds: number | null;
    totalReps: number | null;
    rounds: number | null;
    remainderReps: number | null;
    weightLbs: number | null;
    hitTimeCap: boolean;
  }
): number {
  switch (workoutType) {
    case "for_time":
      return row.timeSeconds ?? Number.POSITIVE_INFINITY;
    case "amrap": {
      if (row.totalReps != null) return row.totalReps;
      // Synthetic ranking: rounds dominate, remainder breaks ties.
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

// GET /api/workouts/[id]/leaderboard
//
// Returns `Record<workoutPartId, LeaderboardEntry[]>` for every part of
// the workout, scoped to active members of the workout's gym. Personal
// workouts return 403 (out of scope for v1 per spec).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: workoutId } = await params;

  const access = await getWorkoutAccess(user.id, workoutId);
  if (!access.exists) {
    return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  }
  if (!access.canRead) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!access.isGymWorkout || !access.communityId) {
    return NextResponse.json(
      { error: "Leaderboards are only available for gym workouts" },
      { status: 403 }
    );
  }

  const parts = await db
    .select({
      id: workoutParts.id,
      workoutType: workoutParts.workoutType,
    })
    .from(workoutParts)
    .where(eq(workoutParts.workoutId, workoutId))
    .orderBy(workoutParts.orderIndex);

  if (parts.length === 0) {
    return NextResponse.json({ parts: {} });
  }

  const partTypeById = new Map<string, WorkoutType>(
    parts.map((p) => [p.id, p.workoutType as WorkoutType])
  );

  // Raw score rows for every part of this workout. We re-filter by active
  // membership below so a deactivated member's stale score is hidden even
  // if RLS would otherwise let it through (defense in depth).
  const rows = await db
    .select({
      scoreId: scores.id,
      workoutPartId: scores.workoutPartId,
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
    .innerJoin(workoutParts, eq(workoutParts.id, scores.workoutPartId))
    .where(eq(workoutParts.workoutId, workoutId));

  if (rows.length === 0) {
    const empty: Record<string, LeaderboardEntry[]> = {};
    for (const p of parts) empty[p.id] = [];
    return NextResponse.json({ parts: empty });
  }

  // Re-filter: only scores from currently active members of the gym
  // count. Stops a deactivated member's old score from haunting today's
  // leaderboard.
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

  // Scaling details — load once for the surviving rows and pivot by scoreId.
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
  };
  let scalingDetails: ScalingDetail[] = [];
  if (scoreIds.length > 0) {
    scalingDetails = await db
      .select({
        scoreId: scoreMovementDetails.scoreId,
        workoutMovementId: scoreMovementDetails.workoutMovementId,
        movementName: movements.canonicalName,
        wasRx: scoreMovementDetails.wasRx,
        actualWeight: scoreMovementDetails.actualWeight,
        actualReps: scoreMovementDetails.actualReps,
        modification: scoreMovementDetails.modification,
        substitutionName: substitutionMovements.canonicalName,
      })
      .from(scoreMovementDetails)
      .innerJoin(
        workoutMovements,
        eq(workoutMovements.id, scoreMovementDetails.workoutMovementId)
      )
      .innerJoin(movements, eq(movements.id, workoutMovements.movementId))
      .leftJoin(
        substitutionMovements,
        eq(substitutionMovements.id, scoreMovementDetails.substitutionMovementId)
      )
      .where(inArray(scoreMovementDetails.scoreId, scoreIds));
  }

  const detailsByScore = new Map<
    string,
    LeaderboardEntry["scalingDetails"]
  >();
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
  }

  const result: Record<string, LeaderboardEntry[]> = {};
  for (const p of parts) result[p.id] = [];

  for (const row of liveRows) {
    const partId = row.workoutPartId;
    if (!partId) continue;
    const workoutType = partTypeById.get(partId);
    if (!workoutType) continue;

    const weightLbsNumber =
      row.weightLbs != null ? Number(row.weightLbs) : null;

    const displayScore = formatBestScore(workoutType, {
      scoreId: row.scoreId,
      workoutId,
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
    });

    const sortValue = computeSortValue(workoutType, {
      timeSeconds: row.timeSeconds,
      totalReps: row.totalReps,
      rounds: row.rounds,
      remainderReps: row.remainderReps,
      weightLbs: weightLbsNumber,
      hitTimeCap: row.hitTimeCap,
    });

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
      scalingDetails: detailsByScore.get(row.scoreId),
      reactionCount: row.reactionCount,
      commentCount: row.commentCount,
      viewerReacted: !!row.viewerReacted,
      createdAt: row.createdAt.toISOString(),
    };

    result[partId].push(entry);
  }

  return NextResponse.json({ parts: result });
}
