// GET  /api/admin/gyms — list all gyms with member + admin counts
// POST /api/admin/gyms — create a gym, optionally seed initial admin by email

import { NextRequest, NextResponse } from "next/server";
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { communities, communityMemberships, users } from "@/db/schema";
import { getAdminUser } from "@/lib/admin";
import { v4 as uuidv4 } from "uuid";

export async function GET() {
  const admin = await getAdminUser();
  if (!admin)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gyms = await db
    .select({
      id: communities.id,
      name: communities.name,
      joinCode: communities.joinCode,
      createdAt: communities.createdAt,
      createdBy: communities.createdBy,
    })
    .from(communities);

  const counts = await db
    .select({
      communityId: communityMemberships.communityId,
      isAdmin: communityMemberships.isAdmin,
      isActive: communityMemberships.isActive,
      n: count(),
    })
    .from(communityMemberships)
    .groupBy(
      communityMemberships.communityId,
      communityMemberships.isAdmin,
      communityMemberships.isActive
    );

  const byGym = new Map<
    string,
    { members: number; activeMembers: number; admins: number }
  >();
  for (const c of counts) {
    const cur = byGym.get(c.communityId) ?? {
      members: 0,
      activeMembers: 0,
      admins: 0,
    };
    cur.members += c.n;
    if (c.isActive) cur.activeMembers += c.n;
    if (c.isAdmin) cur.admins += c.n;
    byGym.set(c.communityId, cur);
  }

  return NextResponse.json(
    gyms.map((g) => ({
      id: g.id,
      name: g.name,
      joinCode: g.joinCode,
      createdAt: g.createdAt,
      createdBy: g.createdBy,
      memberCount: byGym.get(g.id)?.members ?? 0,
      activeMemberCount: byGym.get(g.id)?.activeMembers ?? 0,
      adminCount: byGym.get(g.id)?.admins ?? 0,
    }))
  );
}

export async function POST(req: NextRequest) {
  const admin = await getAdminUser();
  if (!admin)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const adminEmail =
    typeof body.adminEmail === "string"
      ? body.adminEmail.trim().toLowerCase()
      : null;
  const customCode =
    typeof body.customCode === "string"
      ? body.customCode.trim().toUpperCase()
      : null;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (customCode && !/^[A-Z0-9]{4,16}$/.test(customCode)) {
    return NextResponse.json(
      { error: "Custom code must be 4-16 chars, A-Z and 0-9 only" },
      { status: 400 }
    );
  }

  const joinCode = customCode ?? uuidv4().slice(0, 8).toUpperCase();

  // If an admin email was supplied, look up the user before we open the
  // transaction so a missing email fails cleanly instead of mid-write.
  let initialAdminUserId: string | null = null;
  if (adminEmail) {
    const [u] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, adminEmail))
      .limit(1);
    if (!u)
      return NextResponse.json(
        { error: `No user with email ${adminEmail}` },
        { status: 404 }
      );
    initialAdminUserId = u.id;
  }

  try {
    const community = await db.transaction(async (tx) => {
      const [c] = await tx
        .insert(communities)
        .values({ name, joinCode, createdBy: admin.id })
        .returning();
      // Creator is auto-added as admin so the gym always has at least one
      // person who can manage it.
      await tx.insert(communityMemberships).values({
        communityId: c.id,
        userId: admin.id,
        isAdmin: true,
        isCoach: true,
        isActive: true,
      });
      // Optional named admin (e.g. the gym owner). May be the same as the
      // super admin who created it — onConflict noop in that case.
      if (initialAdminUserId && initialAdminUserId !== admin.id) {
        await tx.insert(communityMemberships).values({
          communityId: c.id,
          userId: initialAdminUserId,
          isAdmin: true,
          isCoach: true,
          isActive: true,
        });
      }
      return c;
    });
    return NextResponse.json(community, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { error: "That join code is already in use" },
        { status: 409 }
      );
    }
    throw err;
  }
}
