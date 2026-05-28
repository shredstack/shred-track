// POST /api/workouts/[id]/move-to-gym — move a personal session into a gym
// the caller administers. In the unified schema this is a one-line scope
// swap: flip `user_id` to null and set `community_id`. Scores stay
// attached because the session row itself is the one row that moves.
//
// Gated by the `move_to_gym` per-user feature flag.

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workoutSessions } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canAdminGym } from "@/lib/authz/community";
import { isFlagOn } from "@/lib/feature-flags";
import { updateSession } from "@/lib/crossfit/session-writer";

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

  const [session] = await db
    .select({
      id: workoutSessions.id,
      userId: workoutSessions.userId,
      communityId: workoutSessions.communityId,
    })
    .from(workoutSessions)
    .where(eq(workoutSessions.id, id))
    .limit(1);

  if (!session) {
    return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  }

  if (session.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (session.communityId !== null) {
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

  const updated = await db.transaction(async (tx) =>
    updateSession(tx, id, {
      userId: null,
      communityId: targetCommunityId,
    })
  );

  return NextResponse.json({
    id: updated?.id ?? id,
    communityId: updated?.communityId ?? targetCommunityId,
  });
}
