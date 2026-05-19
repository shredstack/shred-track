// /api/gym/[id]/tracks/[trackId]
//
// GET    — full track + days. Coach/admin only.
// PUT    — update track-level fields (name, dates, displayMode, etc.).
// DELETE — soft archive; hard delete only if no participations + no scores.

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  programmingTracks,
  programmingTrackDays,
  programmingTrackParticipations,
  scores,
  trackDayScores,
  workoutSections,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";

const VALID_DISPLAY = new Set([
  "inline",
  "standalone",
  "inline_and_standalone",
]);
const VALID_INLINE_POS = new Set([
  "top",
  "after_wod",
  "before_at_home",
  "end_of_day",
]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; trackId: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId, trackId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [track] = await db
    .select()
    .from(programmingTracks)
    .where(
      and(
        eq(programmingTracks.id, trackId),
        eq(programmingTracks.communityId, communityId)
      )
    )
    .limit(1);
  if (!track)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const days = await db
    .select()
    .from(programmingTrackDays)
    .where(eq(programmingTrackDays.trackId, trackId))
    .orderBy(asc(programmingTrackDays.date));

  return NextResponse.json({ track, days });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; trackId: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId, trackId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body)
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const [track] = await db
    .select()
    .from(programmingTracks)
    .where(
      and(
        eq(programmingTracks.id, trackId),
        eq(programmingTracks.communityId, communityId)
      )
    )
    .limit(1);
  if (!track)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name;
  if (typeof body.description === "string" || body.description === null)
    patch.description = body.description;
  if (typeof body.startsOn === "string") patch.startsOn = body.startsOn;
  if (typeof body.endsOn === "string") patch.endsOn = body.endsOn;
  if (typeof body.displayMode === "string") {
    if (!VALID_DISPLAY.has(body.displayMode))
      return NextResponse.json({ error: "Invalid displayMode" }, { status: 400 });
    patch.displayMode = body.displayMode;
  }
  if (body.inlinePosition === null) {
    patch.inlinePosition = null;
  } else if (typeof body.inlinePosition === "string") {
    if (!VALID_INLINE_POS.has(body.inlinePosition))
      return NextResponse.json({ error: "Invalid inlinePosition" }, { status: 400 });
    patch.inlinePosition = body.inlinePosition;
  }
  if (typeof body.optInRequired === "boolean")
    patch.optInRequired = body.optInRequired;
  if (body.scoringConfig === null || typeof body.scoringConfig === "object")
    patch.scoringConfig = body.scoringConfig as Record<string, unknown> | null;
  if (typeof body.status === "string") {
    if (!new Set(["draft", "active", "archived"]).has(body.status))
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    patch.status = body.status;
  }
  patch.updatedAt = new Date();

  const [updated] = await db
    .update(programmingTracks)
    .set(patch)
    .where(eq(programmingTracks.id, trackId))
    .returning();
  return NextResponse.json({ track: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; trackId: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId, trackId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [track] = await db
    .select()
    .from(programmingTracks)
    .where(
      and(
        eq(programmingTracks.id, trackId),
        eq(programmingTracks.communityId, communityId)
      )
    )
    .limit(1);
  if (!track)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Hard delete only if zero participations + zero track_day_scores + zero
  // WOD-side scores against any linked workout. Otherwise soft-archive.
  const [partRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(programmingTrackParticipations)
    .where(eq(programmingTrackParticipations.trackId, trackId));
  const [tdsRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(trackDayScores)
    .innerJoin(
      programmingTrackDays,
      eq(trackDayScores.trackDayId, programmingTrackDays.id)
    )
    .where(eq(programmingTrackDays.trackId, trackId));
  const dayWorkoutIds = await db
    .select({ id: programmingTrackDays.workoutId })
    .from(programmingTrackDays)
    .where(eq(programmingTrackDays.trackId, trackId));
  let wodScoreCount = 0;
  for (const row of dayWorkoutIds) {
    if (!row.id) continue;
    const [r] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(scores)
      .where(eq(scores.workoutId, row.id));
    wodScoreCount += r?.c ?? 0;
  }

  const hasData =
    (partRow?.c ?? 0) > 0 || (tdsRow?.c ?? 0) > 0 || wodScoreCount > 0;
  if (hasData) {
    const [archived] = await db
      .update(programmingTracks)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(programmingTracks.id, trackId))
      .returning();
    // Also clear any inline sections pointing at this track so they
    // stop rendering on the CrossFit tab.
    await db
      .delete(workoutSections)
      .where(eq(workoutSections.sourceTrackId, trackId));
    return NextResponse.json({ status: "archived", track: archived });
  }

  await db.delete(programmingTracks).where(eq(programmingTracks.id, trackId));
  return NextResponse.json({ status: "deleted" });
}
