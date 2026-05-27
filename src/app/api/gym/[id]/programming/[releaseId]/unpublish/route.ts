// POST /api/gym/[id]/programming/[releaseId]/unpublish
//
// Reverses a publish: flips the release back to draft, un-flags all of
// the release's workouts (workouts.published=false) so members no longer
// see them on the CrossFit tab, and clears the workout_published
// notifications fired by the original publish.
//
// Notifications are deleted (not just dismissed) so a subsequent
// republish can re-send them — the partial unique index on
// (recipient_id, programming_release_id) WHERE kind='workout_published'
// would otherwise silently swallow the re-send.
//
// Workouts themselves are NOT deleted. Any manual workouts (no
// programming_release_id) are untouched. This is the "I published the
// wrong week, take it back" endpoint.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  notifications,
  programmingReleases,
  workouts,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; releaseId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: communityId, releaseId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Confirm the release belongs to this gym before mutating anything.
  // Without this, a stale/wrong release id would return ok: true while
  // affecting zero rows, masking client bugs.
  const [release] = await db
    .select({ id: programmingReleases.id })
    .from(programmingReleases)
    .where(
      and(
        eq(programmingReleases.id, releaseId),
        eq(programmingReleases.communityId, communityId)
      )
    )
    .limit(1);
  if (!release) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.transaction(async (tx) => {
    await tx
      .update(programmingReleases)
      .set({
        status: "draft",
        publishedAt: null,
        publishedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(programmingReleases.id, releaseId));

    await tx
      .update(workouts)
      .set({ published: false, updatedAt: new Date() })
      .where(eq(workouts.programmingReleaseId, releaseId));

    await tx
      .delete(notifications)
      .where(
        and(
          eq(notifications.programmingReleaseId, releaseId),
          eq(notifications.kind, "workout_published")
        )
      );
  });

  return NextResponse.json({ ok: true });
}
