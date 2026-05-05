// POST /api/communities/[id]/members/[userId]/role
// Body: { isAdmin?: boolean, isCoach?: boolean }
//
// Caller must be an active gym admin of the gym (or super admin).
// Cannot demote the last admin of a gym (400 with a clear error).

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { communityMemberships } from "@/db/schema";
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
  const setIsAdmin =
    typeof body.isAdmin === "boolean" ? body.isAdmin : undefined;
  const setIsCoach =
    typeof body.isCoach === "boolean" ? body.isCoach : undefined;
  if (setIsAdmin === undefined && setIsCoach === undefined) {
    return NextResponse.json(
      { error: "Provide isAdmin and/or isCoach" },
      { status: 400 }
    );
  }

  const [target] = await db
    .select({
      id: communityMemberships.id,
      isAdmin: communityMemberships.isAdmin,
      isCoach: communityMemberships.isCoach,
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

  // Last-admin guard: if we're about to demote an admin to non-admin,
  // make sure another admin exists.
  if (target.isAdmin && setIsAdmin === false) {
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
        { error: "Can't demote the last admin of a gym" },
        { status: 400 }
      );
    }
  }

  const updates: Record<string, boolean> = {};
  if (setIsAdmin !== undefined) updates.isAdmin = setIsAdmin;
  if (setIsCoach !== undefined) updates.isCoach = setIsCoach;

  await db
    .update(communityMemberships)
    .set(updates)
    .where(eq(communityMemberships.id, target.id));

  return NextResponse.json({ ok: true });
}
