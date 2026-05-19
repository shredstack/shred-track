// POST /api/workouts/[id]/move-to-gym — moves a personal workout (the
// caller's, communityId == null) into a gym they admin. Gated by the
// `move_to_gym` per-user feature flag so access is granted explicitly via
// /admin/feature-flags rather than baked-into-code.

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workouts } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canAdminGym } from "@/lib/authz/community";
import { isFlagOn } from "@/lib/feature-flags";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await isFlagOn("move_to_gym", { userId: user.id }))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const targetCommunityId =
    body && typeof body.communityId === "string" ? body.communityId : null;
  if (!targetCommunityId) {
    return NextResponse.json(
      { error: "communityId is required" },
      { status: 400 }
    );
  }

  const [workout] = await db
    .select({
      id: workouts.id,
      createdBy: workouts.createdBy,
      communityId: workouts.communityId,
    })
    .from(workouts)
    .where(eq(workouts.id, id))
    .limit(1);

  if (!workout) {
    return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  }

  if (workout.createdBy !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (workout.communityId !== null) {
    return NextResponse.json(
      { error: "Workout is already attached to a gym" },
      { status: 400 }
    );
  }

  const isAdmin = await canAdminGym(user.id, targetCommunityId);
  if (!isAdmin) {
    return NextResponse.json(
      { error: "You must be an admin of the target gym" },
      { status: 403 }
    );
  }

  const [updated] = await db
    .update(workouts)
    .set({ communityId: targetCommunityId, updatedAt: new Date() })
    .where(eq(workouts.id, id))
    .returning({
      id: workouts.id,
      communityId: workouts.communityId,
    });

  return NextResponse.json(updated);
}
