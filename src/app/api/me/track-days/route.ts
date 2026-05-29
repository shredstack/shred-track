// GET /api/me/track-days?date=YYYY-MM-DD&communityId=<id>
//
// Returns track-day prescriptions for the current user's *opted-in*
// standalone or inline_and_standalone tracks on the given date (spec
// §1.4). Inline-only tracks are excluded — they're already injected as
// workout_sections at publish time so the CrossFit tab renders them via
// the existing path.

import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  programmingTrackDays,
  programmingTrackParticipations,
  programmingTracks,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canViewGym } from "@/lib/authz/community";

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const date = url.searchParams.get("date");
  const communityId = url.searchParams.get("communityId");
  if (!date || !isIsoDate(date)) {
    return NextResponse.json(
      { error: "date (YYYY-MM-DD) required" },
      { status: 400 }
    );
  }
  if (!communityId) {
    return NextResponse.json(
      { error: "communityId required" },
      { status: 400 }
    );
  }
  if (!(await canViewGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Resolve the user's opted-in tracks for this gym whose date range
  // covers `date`.
  const tracks = await db
    .select({
      id: programmingTracks.id,
      name: programmingTracks.name,
      kind: programmingTracks.kind,
      displayMode: programmingTracks.displayMode,
      inlinePosition: programmingTracks.inlinePosition,
      startsOn: programmingTracks.startsOn,
      scoringConfig: programmingTracks.scoringConfig,
    })
    .from(programmingTracks)
    .innerJoin(
      programmingTrackParticipations,
      eq(programmingTrackParticipations.trackId, programmingTracks.id)
    )
    .where(
      and(
        eq(programmingTracks.communityId, communityId),
        eq(programmingTracks.status, "active"),
        eq(programmingTrackParticipations.userId, user.id),
        isNull(programmingTrackParticipations.leftAt),
        or(
          eq(programmingTracks.displayMode, "standalone"),
          eq(programmingTracks.displayMode, "inline_and_standalone")
        ),
        lte(programmingTracks.startsOn, date),
        gte(programmingTracks.endsOn, date)
      )
    );

  if (tracks.length === 0) {
    return NextResponse.json({ trackDays: [] });
  }

  const days = await db
    .select()
    .from(programmingTrackDays)
    .where(
      and(
        inArray(
          programmingTrackDays.trackId,
          tracks.map((t) => t.id)
        ),
        eq(programmingTrackDays.date, date)
      )
    );

  const trackById = new Map(tracks.map((t) => [t.id, t]));

  const trackDays = days.map((d) => {
    const t = trackById.get(d.trackId)!;
    const start = new Date(`${t.startsOn}T00:00:00Z`).getTime();
    const dayMs = new Date(`${d.date}T00:00:00Z`).getTime();
    const dayNumber = Math.floor((dayMs - start) / 86_400_000) + 1;
    return {
      trackDayId: d.id,
      trackId: t.id,
      trackName: t.name,
      kind: t.kind,
      displayMode: t.displayMode,
      dayNumber,
      inlinePosition: t.inlinePosition,
      body: d.body,
      // Wire-field name kept as `workoutId` for client backwards-compat;
      // post-cutover it's a workout_sessions.id. Falls back to the legacy
      // column only for un-backfilled rows.
      workoutId: d.workoutSessionId ?? d.workoutId,
      isScored: d.isScored,
      scoreType: d.scoreType,
      scoringConfig: t.scoringConfig,
      prescribedValue:
        d.prescribedValue == null ? null : Number(d.prescribedValue),
    };
  });

  return NextResponse.json({ trackDays });
}
