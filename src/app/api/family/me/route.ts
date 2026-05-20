// GET  /api/family/me — list the family relationships where I am the
//                       *dependent* (i.e. someone else is my account
//                       holder). Used by the profile page to surface
//                       a "Leave {holder.name}'s account" CTA.
// POST /api/family/me/leave — body { familyMemberId } — dependent
//                       initiates removal (spec §9.2).

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { communities, communityMemberships, familyMembers, users } from "@/db/schema";
import { getSessionUser } from "@/lib/session";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select({
      familyMemberId: familyMembers.id,
      relationship: familyMembers.relationship,
      communityId: familyMembers.communityId,
      communityName: communities.name,
      accountHolderId: familyMembers.accountHolderUserId,
      accountHolderName: users.name,
    })
    .from(familyMembers)
    .innerJoin(
      communities,
      eq(communities.id, familyMembers.communityId)
    )
    .innerJoin(users, eq(users.id, familyMembers.accountHolderUserId))
    .where(eq(familyMembers.dependentUserId, user.id));

  return NextResponse.json({ asDependent: rows });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { familyMemberId?: string }
    | null;
  if (!body?.familyMemberId) {
    return NextResponse.json(
      { error: "familyMemberId is required" },
      { status: 400 }
    );
  }

  const [fm] = await db
    .select()
    .from(familyMembers)
    .where(eq(familyMembers.id, body.familyMemberId))
    .limit(1);
  if (!fm) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (fm.dependentUserId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Per spec §9.2: drop the family link AND deactivate the gym
  // membership. Dependent keeps their global account + history.
  await db.transaction(async (tx) => {
    await tx.delete(familyMembers).where(eq(familyMembers.id, fm.id));
    await tx
      .update(communityMemberships)
      .set({
        isActive: false,
        deactivatedAt: new Date(),
        accountId: fm.dependentUserId,
      })
      .where(
        and(
          eq(communityMemberships.communityId, fm.communityId),
          eq(communityMemberships.userId, fm.dependentUserId)
        )
      );
  });

  return NextResponse.json({ ok: true });
}
