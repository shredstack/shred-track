// /api/track-days/[trackDayId]/leaderboard
//
// Ranked scores for a non-WOD track day (monthly challenge / custom track),
// scoped to active members of the parent track's community. Mirrors the
// auth model from /api/workouts/[id]/leaderboard but reads from
// track_day_scores instead of `scores`.
//
// Monthly challenges are always cumulative (a track of kind
// "monthly_challenge" sums each user's scores across every day of the
// track and ranks by that total) — that matches the "1,200 sit-ups this
// month" mental model regardless of what the coach picked in the
// aggregation dropdown. Custom tracks also become cumulative when
// scoringConfig.aggregation === "sum". Otherwise the leaderboard ranks
// only this specific day.
//
// Sort order is descending by numericValue (higher is better — reps,
// steps, grams, etc.). isComplete=true entries with no numericValue
// still appear at the bottom so "marked done" with no number is visible.

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  communityMemberships,
  programmingTrackDays,
  programmingTracks,
  trackDayScores,
  users,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canViewGym } from "@/lib/authz/community";
import {
  trackScoringUnitLabel,
  type TrackScoringConfig,
} from "@/types/programming-tracks";

export interface TrackDayLeaderboardEntry {
  scoreId: string;
  userId: string;
  userName: string;
  userUsername: string | null;
  userImage: string | null;
  numericValue: number | null;
  unit: string | null;
  isComplete: boolean;
  notes: string | null;
  createdAt: string;
  /** Pre-formatted score for the row (e.g. "120 reps", "Done"). */
  displayScore: string;
  /** Pre-computed sort value (higher = better). */
  sortValue: number;
  /** For cumulative leaderboards, how many days the athlete has logged. */
  daysLogged?: number;
}

export interface TrackDayLeaderboardResponse {
  trackName: string;
  trackKind: string;
  dayDate: string;
  unitLabel: string | null;
  /** True when entries are summed across every day of the track. */
  isCumulative: boolean;
  entries: TrackDayLeaderboardEntry[];
}

function formatTrackDayScore(
  numeric: number | null,
  isComplete: boolean,
  unitLabel: string | null
): string {
  if (numeric != null && Number.isFinite(numeric)) {
    const n = Number.isInteger(numeric) ? numeric : Number(numeric.toFixed(2));
    return unitLabel ? `${n} ${unitLabel}` : String(n);
  }
  return isComplete ? "Done" : "—";
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ trackDayId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { trackDayId } = await params;

  const [day] = await db
    .select({
      id: programmingTrackDays.id,
      trackId: programmingTrackDays.trackId,
      date: programmingTrackDays.date,
      isScored: programmingTrackDays.isScored,
    })
    .from(programmingTrackDays)
    .where(eq(programmingTrackDays.id, trackDayId))
    .limit(1);
  if (!day) {
    return NextResponse.json({ error: "Track day not found" }, { status: 404 });
  }
  if (!day.isScored) {
    return NextResponse.json(
      { error: "This day is not scored" },
      { status: 400 }
    );
  }

  const [track] = await db
    .select({
      id: programmingTracks.id,
      name: programmingTracks.name,
      kind: programmingTracks.kind,
      communityId: programmingTracks.communityId,
      scoringConfig: programmingTracks.scoringConfig,
    })
    .from(programmingTracks)
    .where(eq(programmingTracks.id, day.trackId))
    .limit(1);
  if (!track) {
    return NextResponse.json(
      { error: "Parent track not found" },
      { status: 404 }
    );
  }

  if (!(await canViewGym(user.id, track.communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const config = (track.scoringConfig ?? null) as TrackScoringConfig | null;
  const unitLabel = config ? trackScoringUnitLabel(config) : null;
  // Monthly challenges are cumulative by definition; other kinds opt in
  // via aggregation === "sum".
  const isCumulative =
    track.kind === "monthly_challenge" || config?.aggregation === "sum";

  // Active gym members — used to filter out deactivated users from the
  // leaderboard regardless of whether we're showing a single day or the
  // cumulative total.
  const activeMembers = await db
    .select({ userId: communityMemberships.userId })
    .from(communityMemberships)
    .where(
      and(
        eq(communityMemberships.communityId, track.communityId),
        eq(communityMemberships.isActive, true)
      )
    );
  const activeIds = new Set(activeMembers.map((m) => m.userId));

  let entries: TrackDayLeaderboardEntry[];

  if (isCumulative) {
    // Sum each athlete's scores across every day of the parent track.
    // We join programming_track_days so we can scope to the track without
    // listing every trackDayId up front.
    const aggRows = await db
      .select({
        userId: trackDayScores.userId,
        userName: users.name,
        userUsername: users.username,
        userImage: users.image,
        sumValue: sql<string | null>`sum(${trackDayScores.numericValue})`,
        daysLogged: sql<number>`count(*)::int`,
        anyComplete: sql<boolean>`bool_or(${trackDayScores.isComplete})`,
        // postgres-js returns aggregated timestamps as ISO strings, not
        // Date instances — typed accordingly to avoid `.toISOString()`
        // on a string.
        lastUpdated: sql<string>`max(${trackDayScores.updatedAt})`,
        // All scores for a given track share the same unit (denormalized
        // at write time from the track's scoringConfig). Picking any one
        // is correct; max gives a deterministic choice.
        unit: sql<string | null>`max(${trackDayScores.unit})`,
      })
      .from(trackDayScores)
      .innerJoin(
        programmingTrackDays,
        eq(trackDayScores.trackDayId, programmingTrackDays.id)
      )
      .innerJoin(users, eq(users.id, trackDayScores.userId))
      .where(
        and(
          eq(programmingTrackDays.trackId, track.id),
          // Dependents spec §3.6: shadow users never appear on leaderboards.
          eq(users.isShadow, false)
        )
      )
      .groupBy(
        trackDayScores.userId,
        users.name,
        users.username,
        users.image
      );

    entries = aggRows
      .filter((r) => activeIds.has(r.userId))
      .map((r) => {
        const numeric = r.sumValue != null ? Number(r.sumValue) : null;
        const displayUnit = r.unit ?? unitLabel;
        return {
          // No single scoreId for an aggregated row; userId is stable.
          scoreId: r.userId,
          userId: r.userId,
          userName: r.userName,
          userUsername: r.userUsername,
          userImage: r.userImage,
          numericValue: numeric,
          unit: displayUnit,
          isComplete: r.anyComplete ?? false,
          notes: null,
          createdAt: new Date(r.lastUpdated).toISOString(),
          displayScore: formatTrackDayScore(
            numeric,
            r.anyComplete ?? false,
            displayUnit
          ),
          sortValue: numeric ?? (r.anyComplete ? 0 : -Infinity),
          daysLogged: r.daysLogged,
        };
      })
      .sort((a, b) => b.sortValue - a.sortValue);
  } else {
    // Per-day leaderboard (unchanged behavior).
    const rows = await db
      .select({
        scoreId: trackDayScores.id,
        userId: trackDayScores.userId,
        userName: users.name,
        userUsername: users.username,
        userImage: users.image,
        numericValue: trackDayScores.numericValue,
        unit: trackDayScores.unit,
        isComplete: trackDayScores.isComplete,
        notes: trackDayScores.notes,
        createdAt: trackDayScores.createdAt,
      })
      .from(trackDayScores)
      .innerJoin(users, eq(users.id, trackDayScores.userId))
      .where(
        and(
          eq(trackDayScores.trackDayId, trackDayId),
          // Dependents spec §3.6: shadow users never appear on leaderboards.
          eq(users.isShadow, false)
        )
      );

    entries = rows
      .filter((r) => activeIds.has(r.userId))
      .map((r) => {
        const numeric =
          r.numericValue != null ? Number(r.numericValue) : null;
        const displayUnit = r.unit ?? unitLabel;
        return {
          scoreId: r.scoreId,
          userId: r.userId,
          userName: r.userName,
          userUsername: r.userUsername,
          userImage: r.userImage,
          numericValue: numeric,
          unit: displayUnit,
          isComplete: r.isComplete,
          notes: r.notes,
          createdAt: r.createdAt.toISOString(),
          displayScore: formatTrackDayScore(numeric, r.isComplete, displayUnit),
          sortValue: numeric ?? (r.isComplete ? 0 : -Infinity),
        };
      })
      // Higher numeric is better; "marked done with no number" sinks
      // toward the bottom; "not complete and no number" sinks to the very
      // bottom.
      .sort((a, b) => b.sortValue - a.sortValue);
  }

  const response: TrackDayLeaderboardResponse = {
    trackName: track.name,
    trackKind: track.kind,
    dayDate: day.date,
    unitLabel,
    isCumulative,
    entries,
  };
  return NextResponse.json(response);
}
