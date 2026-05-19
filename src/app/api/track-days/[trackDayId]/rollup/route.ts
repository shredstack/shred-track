// GET /api/track-days/[trackDayId]/rollup
//
// Returns aggregate stats for the parent track + the user's score on
// today's row (spec §3.6). Cheap to compute — one aggregation query per
// hit. No materialized rollup table for v1.

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  programmingTrackDays,
  programmingTracks,
  trackDayScores,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canViewGym } from "@/lib/authz/community";
import type { TrackScoringConfig } from "@/types/programming-tracks";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ trackDayId: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { trackDayId } = await params;

  const [day] = await db
    .select({
      id: programmingTrackDays.id,
      trackId: programmingTrackDays.trackId,
    })
    .from(programmingTrackDays)
    .where(eq(programmingTrackDays.id, trackDayId))
    .limit(1);
  if (!day)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [track] = await db
    .select({
      id: programmingTracks.id,
      kind: programmingTracks.kind,
      communityId: programmingTracks.communityId,
      scoringConfig: programmingTracks.scoringConfig,
    })
    .from(programmingTracks)
    .where(eq(programmingTracks.id, day.trackId))
    .limit(1);
  if (!track)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canViewGym(user.id, track.communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const config = (track.scoringConfig ?? null) as TrackScoringConfig | null;

  // Today's score.
  const [todayRow] = await db
    .select({
      numericValue: trackDayScores.numericValue,
      isComplete: trackDayScores.isComplete,
    })
    .from(trackDayScores)
    .where(
      and(
        eq(trackDayScores.trackDayId, trackDayId),
        eq(trackDayScores.userId, user.id)
      )
    )
    .limit(1);

  // Aggregate across all of this user's scores for the parent track.
  const [agg] = await db
    .select({
      sum: sql<string | null>`sum(${trackDayScores.numericValue})`,
      daysLogged: sql<number>`count(*)::int`,
    })
    .from(trackDayScores)
    .innerJoin(
      programmingTrackDays,
      eq(trackDayScores.trackDayId, programmingTrackDays.id)
    )
    .where(
      and(
        eq(programmingTrackDays.trackId, track.id),
        eq(trackDayScores.userId, user.id)
      )
    );

  const [available] = await db
    .select({ daysAvailable: sql<number>`count(*)::int` })
    .from(programmingTrackDays)
    .where(eq(programmingTrackDays.trackId, track.id));

  // Monthly challenges are cumulative by definition; other kinds opt in
  // via aggregation === "sum". Mirrors the leaderboard route so the
  // athlete's per-day UI and the gym-wide ranking agree.
  const isCumulative =
    track.kind === "monthly_challenge" || config?.aggregation === "sum";

  return NextResponse.json({
    today: {
      numericValue:
        todayRow?.numericValue != null ? Number(todayRow.numericValue) : null,
      isComplete: todayRow?.isComplete ?? false,
    },
    sum: agg?.sum != null ? Number(agg.sum) : 0,
    daysLogged: agg?.daysLogged ?? 0,
    daysAvailable: available?.daysAvailable ?? 0,
    aggregation: config?.aggregation ?? "per_day_independent",
    isCumulative,
    dailyTarget: config?.dailyTarget ?? null,
    unit: config?.unit ?? null,
    unitLabel: config?.unitLabel ?? null,
  });
}
