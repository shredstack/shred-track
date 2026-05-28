// DELETE /api/gym/[id]/programming/[releaseId]
//
// Wipes a programming release entirely: removes every session tied to
// the release (and its scores via cascade) plus the release row itself.
// Manual sessions on those same dates (sessions without a
// programming_release_id) are NOT touched.
//
// Use case: coach published the wrong week and wants to start over,
// without disturbing any ad-hoc WODs an athlete or another coach added
// from the CrossFit tab.
//
// Two cross-domain references (class_instances.workout_session_id,
// gym_posts.workout_session_id) have no ON DELETE rule, so we null them
// out inside the same transaction before deleting the sessions.

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  classInstances,
  gymPosts,
  notifications,
  programmingReleases,
  workoutSessions,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; releaseId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: communityId, releaseId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Confirm release belongs to this gym before doing anything destructive.
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
    const programmedSessions = await tx
      .select({ id: workoutSessions.id })
      .from(workoutSessions)
      .where(eq(workoutSessions.programmingReleaseId, releaseId));
    const ids = programmedSessions.map((s) => s.id);

    if (ids.length) {
      // Null the non-cascading references first so the sessions delete
      // doesn't trip an FK constraint.
      await tx
        .update(classInstances)
        .set({ workoutSessionId: null })
        .where(inArray(classInstances.workoutSessionId, ids));
      await tx
        .update(gymPosts)
        .set({ workoutSessionId: null })
        .where(inArray(gymPosts.workoutSessionId, ids));

      await tx
        .delete(workoutSessions)
        .where(inArray(workoutSessions.id, ids));
    }

    // Drop any workout_published notifications fired by a prior publish,
    // and the release itself.
    await tx
      .delete(notifications)
      .where(
        and(
          eq(notifications.programmingReleaseId, releaseId),
          eq(notifications.kind, "workout_published")
        )
      );

    await tx
      .delete(programmingReleases)
      .where(eq(programmingReleases.id, releaseId));
  });

  return NextResponse.json({ ok: true });
}
