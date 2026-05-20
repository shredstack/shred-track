// POST /api/admin/gyms/[id]/admins
// Body: { email: string }
//
// Super-admin only. Looks up the user, creates an active admin+coach
// membership in the gym (or upgrades an existing one).

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { communityMemberships, users } from "@/db/schema";
import { getAdminUser } from "@/lib/admin";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getAdminUser();
  if (!admin)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email)
    return NextResponse.json({ error: "email is required" }, { status: 400 });

  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!target)
    return NextResponse.json(
      { error: `No user with email ${email}` },
      { status: 404 }
    );

  const [existing] = await db
    .select({ id: communityMemberships.id })
    .from(communityMemberships)
    .where(
      and(
        eq(communityMemberships.communityId, id),
        eq(communityMemberships.userId, target.id)
      )
    )
    .limit(1);

  if (existing) {
    await db
      .update(communityMemberships)
      .set({
        isAdmin: true,
        isCoach: true,
        isActive: true,
        deactivatedAt: null,
      })
      .where(eq(communityMemberships.id, existing.id));
  } else {
    await db.insert(communityMemberships).values({
      communityId: id,
      userId: target.id,
      accountId: target.id,
      isAdmin: true,
      isCoach: true,
      isActive: true,
    });
  }

  return NextResponse.json({ ok: true, userId: target.id });
}
