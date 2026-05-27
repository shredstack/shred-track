// DELETE /api/gym/[id]/programming/[releaseId]
//
// Wipes a programming release entirely: removes every workout tied to
// the release (and its sections, parts, scores via cascade) plus the
// release row itself. Manual workouts on those same dates (workouts
// without a programming_release_id) are NOT touched.
//
// Use case: coach published the wrong week and wants to start over,
// without disturbing any ad-hoc WODs an athlete or another coach added
// from the CrossFit tab.
//
// Two FK references into workouts (class_instances.workout_id,
// gym_posts.workout_id) have no ON DELETE rule, so we null them out
// inside the same transaction before deleting the workouts.

import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  classInstances,
  gymPosts,
  notifications,
  programmingReleases,
  workouts,
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
    const programmedWorkouts = await tx
      .select({ id: workouts.id })
      .from(workouts)
      .where(eq(workouts.programmingReleaseId, releaseId));
    const ids = programmedWorkouts.map((w) => w.id);

    if (ids.length) {
      // Null the non-cascading references first so the workouts delete
      // doesn't trip an FK constraint.
      await tx
        .update(classInstances)
        .set({ workoutId: null })
        .where(inArray(classInstances.workoutId, ids));
      await tx
        .update(gymPosts)
        .set({ workoutId: null })
        .where(inArray(gymPosts.workoutId, ids));

      await tx.delete(workouts).where(inArray(workouts.id, ids));
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
