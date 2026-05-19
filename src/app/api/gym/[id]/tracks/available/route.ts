// GET /api/gym/[id]/tracks/available
//
// Returns active standalone-capable tracks whose date range overlaps today,
// plus the current user's participation status. Used by the Available
// tracks sheet on the CrossFit tab (spec §1.4).

import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  programmingTrackParticipations,
  programmingTracks,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canViewGym } from "@/lib/authz/community";

function todayIso(): string {
  // Server uses UTC; the gym tz isn't important here because the date
  // range is daily granularity and the route is only a "today overlaps"
  // filter, not a per-day prescription lookup.
  return new Date().toISOString().slice(0, 10);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId } = await params;
  if (!(await canViewGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const today = todayIso();
  const tracks = await db
    .select({
      id: programmingTracks.id,
      name: programmingTracks.name,
      kind: programmingTracks.kind,
      description: programmingTracks.description,
      startsOn: programmingTracks.startsOn,
      endsOn: programmingTracks.endsOn,
      displayMode: programmingTracks.displayMode,
      inlinePosition: programmingTracks.inlinePosition,
      scoringConfig: programmingTracks.scoringConfig,
    })
    .from(programmingTracks)
    .where(
      and(
        eq(programmingTracks.communityId, communityId),
        eq(programmingTracks.status, "active"),
        or(
          eq(programmingTracks.displayMode, "standalone"),
          eq(programmingTracks.displayMode, "inline_and_standalone")
        ),
        lte(programmingTracks.startsOn, today),
        gte(programmingTracks.endsOn, today)
      )
    );

  if (tracks.length === 0) {
    return NextResponse.json({ tracks: [] });
  }

  const trackIds = tracks.map((t) => t.id);
  const myParticipations = await db
    .select({
      trackId: programmingTrackParticipations.trackId,
      leftAt: programmingTrackParticipations.leftAt,
    })
    .from(programmingTrackParticipations)
    .where(
      and(
        eq(programmingTrackParticipations.userId, user.id),
        inArray(programmingTrackParticipations.trackId, trackIds)
      )
    );
  const joinedTrackIds = new Set(
    myParticipations.filter((p) => p.leftAt == null).map((p) => p.trackId)
  );

  const counts = await db
    .select({
      trackId: programmingTrackParticipations.trackId,
      count: sql<number>`count(*)::int`,
    })
    .from(programmingTrackParticipations)
    .where(
      and(
        inArray(programmingTrackParticipations.trackId, trackIds),
        isNull(programmingTrackParticipations.leftAt)
      )
    )
    .groupBy(programmingTrackParticipations.trackId);
  const countByTrack = new Map(counts.map((c) => [c.trackId, c.count]));

  return NextResponse.json({
    tracks: tracks.map((t) => ({
      ...t,
      isJoined: joinedTrackIds.has(t.id),
      memberCount: countByTrack.get(t.id) ?? 0,
    })),
  });
}
