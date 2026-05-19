// POST /api/communities/[id]/members/[userId]/remove
//
// Atomically strips a member's admin/coach roles AND marks them inactive
// in a single transaction. Used by the super-admin gyms page so that a
// partial failure can't leave a user role-less but still active (or vice
// versa). Caller must be a gym admin (or super admin).

import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { communityMemberships, users } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canAdminGym } from "@/lib/authz/community";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const caller = await getSessionUser();
  if (!caller)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, userId } = await params;
  const ok = await canAdminGym(caller.id, id);
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

  // Last-admin guard: if this user is currently an admin, ensure another
  // active admin remains.
  if (target.isAdmin) {
    const [otherAdmin] = await db
      .select({ id: communityMemberships.id })
      .from(communityMemberships)
      .where(
        and(
          eq(communityMemberships.communityId, id),
          eq(communityMemberships.isAdmin, true),
          eq(communityMemberships.isActive, true),
          ne(communityMemberships.id, target.id)
        )
      )
      .limit(1);
    if (!otherAdmin) {
      return NextResponse.json(
        { error: "Can't remove the last admin of a gym" },
        { status: 400 }
      );
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(communityMemberships)
      .set({
        isAdmin: false,
        isCoach: false,
        isActive: false,
        deactivatedAt: new Date(),
      })
      .where(eq(communityMemberships.id, target.id));

    await tx
      .update(users)
      .set({ activeCommunityId: null, updatedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.activeCommunityId, id)));
  });

  return NextResponse.json({ ok: true });
}
