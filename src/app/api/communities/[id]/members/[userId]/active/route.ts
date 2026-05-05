// POST /api/communities/[id]/members/[userId]/active
// Body: { isActive: boolean }
//
// Toggles a member's active state. Inactive members can't see the gym's
// programming or appear on the leaderboard but their historical scores
// remain. Caller must be a gym admin (or super admin).

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { communityMemberships, users } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canAdminGym } from "@/lib/authz/community";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const caller = await getSessionUser();
  if (!caller)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, userId } = await params;
  const ok = await canAdminGym(caller.id, id);
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  if (typeof body.isActive !== "boolean") {
    return NextResponse.json({ error: "isActive boolean required" }, { status: 400 });
  }

  const [target] = await db
    .select({
      id: communityMemberships.id,
      isAdmin: communityMemberships.isAdmin,
    })
    .from(communityMemberships)
    .where(
      and(
        eq(communityMemberships.communityId, id),
        eq(communityMemberships.userId, userId)
      )
    )
    .limit(1);
  if (!target)
    return NextResponse.json({ error: "Member not found" }, { status: 404 });

  // Last-admin guard: deactivating the last admin would leave the gym
  // unmanaged. Disallow.
  if (target.isAdmin && body.isActive === false) {
    const otherAdmins = await db
      .select({ id: communityMemberships.id })
      .from(communityMemberships)
      .where(
        and(
          eq(communityMemberships.communityId, id),
          eq(communityMemberships.isAdmin, true),
          eq(communityMemberships.isActive, true)
        )
      );
    const remaining = otherAdmins.filter((a) => a.id !== target.id);
    if (remaining.length === 0) {
      return NextResponse.json(
        { error: "Can't deactivate the last admin" },
        { status: 400 }
      );
    }
  }

  await db
    .update(communityMemberships)
    .set({
      isActive: body.isActive,
      deactivatedAt: body.isActive ? null : new Date(),
    })
    .where(eq(communityMemberships.id, target.id));

  // If we just deactivated this user and their active gym is *this* gym,
  // null it out so they don't keep seeing the gym's programming.
  if (body.isActive === false) {
    await db
      .update(users)
      .set({ activeCommunityId: null, updatedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.activeCommunityId, id)));
  }

  return NextResponse.json({ ok: true });
}
