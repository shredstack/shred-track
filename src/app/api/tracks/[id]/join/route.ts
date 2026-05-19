// POST /api/tracks/[id]/join — opt-in to a track (Murph Prep flow)
// DELETE /api/tracks/[id]/join — opt-out (sets left_at)

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  programmingTrackParticipations,
  programmingTracks,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canViewGym } from "@/lib/authz/community";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: trackId } = await params;
  const [track] = await db
    .select({ communityId: programmingTracks.communityId })
    .from(programmingTracks)
    .where(eq(programmingTracks.id, trackId))
    .limit(1);
  if (!track) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canViewGym(user.id, track.communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Idempotent: if an active participation already exists, return ok.
  const [existing] = await db
    .select()
    .from(programmingTrackParticipations)
    .where(
      and(
        eq(programmingTrackParticipations.trackId, trackId),
        eq(programmingTrackParticipations.userId, user.id),
        isNull(programmingTrackParticipations.leftAt)
      )
    )
    .limit(1);
  if (existing) return NextResponse.json({ ok: true });
  await db.insert(programmingTrackParticipations).values({
    trackId,
    userId: user.id,
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: trackId } = await params;
  await db
    .update(programmingTrackParticipations)
    .set({ leftAt: new Date() })
    .where(
      and(
        eq(programmingTrackParticipations.trackId, trackId),
        eq(programmingTrackParticipations.userId, user.id),
        isNull(programmingTrackParticipations.leftAt)
      )
    );
  return new NextResponse(null, { status: 204 });
}
