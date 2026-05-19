// /api/gym/[id]/tracks/[trackId]/participations
//
// POST   — opt the current user into a track (idempotent — creates a row
//          or clears `leftAt` on an existing row).
// DELETE — opt out (sets `leftAt = now()`).
//
// Authorization: gym membership required. Inline-only tracks are still
// accepted (they're already showing on the athlete's day), but the opt-in
// row lets them appear in the Available tracks UI.

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
  { params }: { params: Promise<{ id: string; trackId: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId, trackId } = await params;
  if (!(await canViewGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [track] = await db
    .select({
      id: programmingTracks.id,
      status: programmingTracks.status,
    })
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
  if (track.status === "archived") {
    return NextResponse.json(
      { error: "Track is archived" },
      { status: 400 }
    );
  }

  // Look for any existing participation row. If active, no-op. If left,
  // clear `leftAt`. Otherwise insert.
  const [existing] = await db
    .select()
    .from(programmingTrackParticipations)
    .where(
      and(
        eq(programmingTrackParticipations.trackId, trackId),
        eq(programmingTrackParticipations.userId, user.id)
      )
    )
    .orderBy(programmingTrackParticipations.joinedAt)
    .limit(1);

  if (existing && existing.leftAt === null) {
    return NextResponse.json({ participation: existing });
  }
  if (existing) {
    const [reactivated] = await db
      .update(programmingTrackParticipations)
      .set({ leftAt: null, joinedAt: new Date() })
      .where(eq(programmingTrackParticipations.id, existing.id))
      .returning();
    return NextResponse.json({ participation: reactivated });
  }
  const [created] = await db
    .insert(programmingTrackParticipations)
    .values({ trackId, userId: user.id })
    .returning();
  return NextResponse.json({ participation: created }, { status: 201 });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; trackId: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId, trackId } = await params;
  if (!(await canViewGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [row] = await db
    .update(programmingTrackParticipations)
    .set({ leftAt: new Date() })
    .where(
      and(
        eq(programmingTrackParticipations.trackId, trackId),
        eq(programmingTrackParticipations.userId, user.id),
        isNull(programmingTrackParticipations.leftAt)
      )
    )
    .returning();
  return NextResponse.json({ participation: row ?? null });
}
