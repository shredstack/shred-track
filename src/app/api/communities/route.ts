import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { communities, communityMemberships } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { getAdminUser } from "@/lib/admin";
import { v4 as uuidv4 } from "uuid";

// GET /api/communities — list communities the user is an active member of.
// Inactive memberships are excluded so a user removed from a gym doesn't
// see it lingering in their list.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select({
      id: communities.id,
      name: communities.name,
      // Only admins of the gym should see the join code from here.
      joinCode: communities.joinCode,
      createdBy: communities.createdBy,
      isAdmin: communityMemberships.isAdmin,
      isCoach: communityMemberships.isCoach,
      isActive: communityMemberships.isActive,
      joinedAt: communityMemberships.joinedAt,
      createdAt: communities.createdAt,
    })
    .from(communityMemberships)
    .innerJoin(communities, eq(communities.id, communityMemberships.communityId))
    .where(
      and(
        eq(communityMemberships.userId, user.id),
        eq(communityMemberships.isActive, true)
      )
    );

  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      // Strip the join code from members.
      joinCode: r.isAdmin ? r.joinCode : null,
      createdBy: r.createdBy,
      isAdmin: r.isAdmin,
      isCoach: r.isCoach,
      isActive: r.isActive,
      joinedAt: r.joinedAt,
      createdAt: r.createdAt,
    }))
  );
}

// POST /api/communities — create a new community. Restricted to super admin
// so any random user can't spin up a "gym of one" with our join-code
// namespace. Use /api/admin/gyms going forward; this route is kept for
// backwards compat with existing scripts/tests.
export async function POST(req: NextRequest) {
  const admin = await getAdminUser();
  if (!admin)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name } = body;
  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const joinCode = uuidv4().slice(0, 8).toUpperCase();

  const [community] = await db
    .insert(communities)
    .values({ name, joinCode, createdBy: admin.id })
    .returning();

  // Auto-add creator as admin + coach + active.
  await db.insert(communityMemberships).values({
    communityId: community.id,
    userId: admin.id,
    isAdmin: true,
    isCoach: true,
    isActive: true,
  });

  return NextResponse.json(community, { status: 201 });
}
