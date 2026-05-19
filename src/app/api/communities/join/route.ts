import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { communities, communityMemberships, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { hasRequiredOnJoinDocs } from "@/lib/documents";

// POST /api/communities/join — join a community with a code.
// On success the user is set to this community as their active gym so the
// header dropdown immediately reflects the new membership.
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { code } = body;
  if (!code || typeof code !== "string") {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  const normalized = code.trim().toUpperCase();
  const [community] = await db
    .select()
    .from(communities)
    .where(eq(communities.joinCode, normalized))
    .limit(1);

  if (!community) {
    return NextResponse.json({ error: "Invalid join code" }, { status: 404 });
  }

  // Re-activate an existing inactive membership rather than failing the
  // unique constraint. A gym admin who deactivated and then re-invited a
  // member with the same code shouldn't blow up.
  const [existing] = await db
    .select({
      id: communityMemberships.id,
      isActive: communityMemberships.isActive,
    })
    .from(communityMemberships)
    .where(
      and(
        eq(communityMemberships.communityId, community.id),
        eq(communityMemberships.userId, user.id)
      )
    )
    .limit(1);

  // Sign-on-join (PR 3 §3.2): if this gym has required-on-join docs,
  // create/keep the membership inactive until signatures land. The
  // sign endpoint flips isActive=true once the queue is empty.
  const requiresDocs = await hasRequiredOnJoinDocs(community.id);

  if (existing) {
    if (!existing.isActive && !requiresDocs) {
      await db
        .update(communityMemberships)
        .set({ isActive: true, deactivatedAt: null })
        .where(eq(communityMemberships.id, existing.id));
    }
    // If existing.isActive is already true: leave it alone (an existing
    // member shouldn't get bounced back through the sign flow on a
    // reissued code; instead they'll see the re-sign banner if a new
    // version was published).
  } else {
    await db.insert(communityMemberships).values({
      communityId: community.id,
      userId: user.id,
      isAdmin: false,
      isCoach: false,
      isActive: !requiresDocs,
    });
  }

  // Make this gym the user's active gym so the rest of the UI updates.
  await db
    .update(users)
    .set({ activeCommunityId: community.id, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  return NextResponse.json(
    {
      communityId: community.id,
      name: community.name,
      requiresDocuments: requiresDocs,
    },
    { status: 200 }
  );
}
