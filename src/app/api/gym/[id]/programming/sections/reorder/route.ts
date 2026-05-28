// POST /api/gym/[id]/programming/sections/reorder
//
// Bulk-update the `position` field on a set of workout sessions so the
// coach can drag-reorder a day's sections in one round trip. In the
// unified schema sections ARE workout_sessions rows grouped by
// (community_id, workout_date); reordering is just a position rewrite.
//
// Body: { workoutDate, orderedSectionIds: string[] } — `workoutDate` is
// the canonical day key in the new model. The legacy `workoutId` field is
// still accepted on the wire (clients haven't migrated yet) but ignored;
// the validation runs against the day grouping.

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { workoutSessions } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: communityId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    workoutId?: string;
    workoutDate?: string;
    orderedSectionIds?: string[];
  } | null;

  if (!Array.isArray(body?.orderedSectionIds) || body.orderedSectionIds.length === 0) {
    return NextResponse.json(
      { error: "orderedSectionIds must be a non-empty array" },
      { status: 400 }
    );
  }

  // Resolve the workout date. Prefer the explicit field; fall back to
  // reading it off the first session id when a legacy client only sends
  // `workoutId` (which post-cutover IS the day's first session id).
  let workoutDate = body?.workoutDate;
  if (!workoutDate || !/^\d{4}-\d{2}-\d{2}$/.test(workoutDate)) {
    const probeId = body?.workoutId ?? body.orderedSectionIds[0];
    const [first] = await db
      .select({
        workoutDate: workoutSessions.workoutDate,
        communityId: workoutSessions.communityId,
      })
      .from(workoutSessions)
      .where(eq(workoutSessions.id, probeId))
      .limit(1);
    if (!first || first.communityId !== communityId) {
      return NextResponse.json(
        { error: "Could not resolve workoutDate from the supplied ids" },
        { status: 400 }
      );
    }
    workoutDate = first.workoutDate;
  }

  // Confirm every id actually belongs to this gym + date.
  const existing = await db
    .select({ id: workoutSessions.id })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.communityId, communityId),
        eq(workoutSessions.workoutDate, workoutDate),
        inArray(workoutSessions.id, body.orderedSectionIds)
      )
    );
  if (existing.length !== body.orderedSectionIds.length) {
    return NextResponse.json(
      { error: "One or more sections do not belong to this day" },
      { status: 400 }
    );
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < body.orderedSectionIds!.length; i++) {
      await tx
        .update(workoutSessions)
        .set({ position: i, updatedAt: new Date() })
        .where(eq(workoutSessions.id, body.orderedSectionIds![i]));
    }
  });

  return NextResponse.json({ ok: true });
}
