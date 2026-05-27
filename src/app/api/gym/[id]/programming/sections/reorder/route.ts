// POST /api/gym/[id]/programming/sections/reorder
//
// Bulk-update the `position` field on a set of workout sections so the
// coach can drag-reorder a day's sections in one round trip. Each PATCH
// of /sections stamps reviewedAt as a side effect, which is fine for
// content edits but noisy when the only change is row order — this
// endpoint updates positions atomically without touching reviewedAt.
//
// Body: { workoutId, orderedSectionIds: string[] }
// All section ids must belong to the same workout and to this gym.

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { workoutSections, workouts } from "@/db/schema";
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
    orderedSectionIds?: string[];
  } | null;

  if (!body?.workoutId) {
    return NextResponse.json({ error: "workoutId is required" }, { status: 400 });
  }
  if (!Array.isArray(body.orderedSectionIds) || body.orderedSectionIds.length === 0) {
    return NextResponse.json(
      { error: "orderedSectionIds must be a non-empty array" },
      { status: 400 }
    );
  }

  const [w] = await db
    .select({ id: workouts.id })
    .from(workouts)
    .where(and(eq(workouts.id, body.workoutId), eq(workouts.communityId, communityId)))
    .limit(1);
  if (!w) {
    return NextResponse.json({ error: "Workout not in this gym" }, { status: 404 });
  }

  // Confirm every id actually belongs to this workout — guards against a
  // client that mixed in stale ids from a different day.
  const existing = await db
    .select({ id: workoutSections.id })
    .from(workoutSections)
    .where(
      and(
        eq(workoutSections.workoutId, body.workoutId),
        inArray(workoutSections.id, body.orderedSectionIds)
      )
    );
  if (existing.length !== body.orderedSectionIds.length) {
    return NextResponse.json(
      { error: "One or more sections do not belong to this workout" },
      { status: 400 }
    );
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < body.orderedSectionIds!.length; i++) {
      await tx
        .update(workoutSections)
        .set({ position: i, updatedAt: new Date() })
        .where(eq(workoutSections.id, body.orderedSectionIds![i]));
    }
  });

  return NextResponse.json({ ok: true });
}
