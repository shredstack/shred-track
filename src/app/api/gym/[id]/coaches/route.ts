// GET /api/gym/[id]/coaches
//
// Returns active coach/admin users for a gym. Used by the classes admin view
// to populate the per-instance coach picker.

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { communityMemberships, users } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      image: users.image,
      isAdmin: communityMemberships.isAdmin,
      isCoach: communityMemberships.isCoach,
    })
    .from(communityMemberships)
    .innerJoin(users, eq(users.id, communityMemberships.userId))
    .where(
      and(
        eq(communityMemberships.communityId, communityId),
        eq(communityMemberships.isActive, true),
        or(
          eq(communityMemberships.isCoach, true),
          eq(communityMemberships.isAdmin, true)
        )
      )
    )
    .orderBy(asc(users.name));
  return NextResponse.json({ coaches: rows });
}
