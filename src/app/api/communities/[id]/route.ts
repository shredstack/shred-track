// GET /api/communities/[id]      — gym detail (active members only)
// PATCH /api/communities/[id]    — rename the gym (admins only)

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { communities } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canAdminGym, canViewGym, getGymRole } from "@/lib/authz/community";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const ok = await canViewGym(user.id, id);
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [community] = await db
    .select()
    .from(communities)
    .where(eq(communities.id, id))
    .limit(1);
  if (!community)
    return NextResponse.json({ error: "Gym not found" }, { status: 404 });

  // Strip join code unless caller is gym admin (or super admin via canAdminGym).
  const role = await getGymRole(user.id, id);
  const isAdmin = await canAdminGym(user.id, id);
  return NextResponse.json({
    id: community.id,
    name: community.name,
    joinCode: isAdmin ? community.joinCode : null,
    createdBy: community.createdBy,
    createdAt: community.createdAt,
    websiteUrl: community.websiteUrl,
    adminEmail: isAdmin ? community.adminEmail : null,
    role: role
      ? { isAdmin: role.isAdmin, isCoach: role.isCoach, isActive: role.isActive }
      : null,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const ok = await canAdminGym(user.id, id);
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const name =
    typeof body.name === "string" ? body.name.trim() : undefined;
  if (name !== undefined && name.length === 0) {
    return NextResponse.json({ error: "Name can't be empty" }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) updates.name = name;
  if ("websiteUrl" in body) {
    const raw = body.websiteUrl;
    if (raw === null || raw === "") {
      updates.websiteUrl = null;
    } else if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed && !/^https?:\/\//i.test(trimmed)) {
        return NextResponse.json(
          { error: "websiteUrl must start with http:// or https://" },
          { status: 400 }
        );
      }
      updates.websiteUrl = trimmed || null;
    }
  }
  if ("adminEmail" in body) {
    const raw = body.adminEmail;
    if (raw === null || raw === "") {
      updates.adminEmail = null;
    } else if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        return NextResponse.json(
          { error: "adminEmail is not a valid email" },
          { status: 400 }
        );
      }
      updates.adminEmail = trimmed || null;
    }
  }

  const [updated] = await db
    .update(communities)
    .set(updates)
    .where(eq(communities.id, id))
    .returning();
  if (!updated)
    return NextResponse.json({ error: "Gym not found" }, { status: 404 });

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    websiteUrl: updated.websiteUrl,
    adminEmail: updated.adminEmail,
  });
}
