// GET /api/communities/[id]/members
// Lists members of a gym with their personal details (name, email).
// Restricted to coaches, admins, and super admins — regular members
// shouldn't see other members' contact info.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { communityMemberships, users } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canProgramForGym } from "@/lib/authz/community";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const ok = await canProgramForGym(user.id, id);
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = await db
    .select({
      membershipId: communityMemberships.id,
      userId: communityMemberships.userId,
      isAdmin: communityMemberships.isAdmin,
      isCoach: communityMemberships.isCoach,
      isActive: communityMemberships.isActive,
      joinedAt: communityMemberships.joinedAt,
      deactivatedAt: communityMemberships.deactivatedAt,
      name: users.name,
      email: users.email,
    })
    .from(communityMemberships)
    .innerJoin(users, eq(users.id, communityMemberships.userId))
    .where(eq(communityMemberships.communityId, id));

  return NextResponse.json(rows);
}
