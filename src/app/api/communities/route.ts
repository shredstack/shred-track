import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { communities, communityMemberships } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { v4 as uuidv4 } from "uuid";

// GET /api/communities — list communities the user belongs to
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select({
      id: communities.id,
      name: communities.name,
      joinCode: communities.joinCode,
      createdBy: communities.createdBy,
      role: communityMemberships.role,
      joinedAt: communityMemberships.joinedAt,
      createdAt: communities.createdAt,
    })
    .from(communityMemberships)
    .innerJoin(communities, eq(communities.id, communityMemberships.communityId))
    .where(eq(communityMemberships.userId, user.id));

  return NextResponse.json(rows);
}

// POST /api/communities — create a new community
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name } = body;
  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const joinCode = uuidv4().slice(0, 8).toUpperCase();

  const [community] = await db
    .insert(communities)
    .values({ name, joinCode, createdBy: user.id })
    .returning();

  // Auto-add creator as admin
  await db.insert(communityMemberships).values({
    communityId: community.id,
    userId: user.id,
    role: "admin",
  });

  return NextResponse.json(community, { status: 201 });
}
