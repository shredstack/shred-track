// POST /api/communities/join-by-slug
//
// Join (or re-activate) a community via its invite URL slug. Only honored
// when the community has `auto_join_via_link = true` — otherwise the slug
// page still resolves to the gym branding (so a logged-out visitor sees a
// nice "Join CrossFit Draper" page) but actual joining requires the
// regular join code flow.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { communities, communityMemberships, users } from "@/db/schema";
import { getSessionUser } from "@/lib/session";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { slug?: string } | null;
  if (!body?.slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  const [community] = await db
    .select({
      id: communities.id,
      name: communities.name,
      autoJoinViaLink: communities.autoJoinViaLink,
    })
    .from(communities)
    .where(eq(communities.inviteUrlSlug, body.slug.toLowerCase()))
    .limit(1);

  if (!community) {
    return NextResponse.json({ error: "Unknown invite link" }, { status: 404 });
  }

  if (!community.autoJoinViaLink) {
    return NextResponse.json(
      { error: "This gym's invite link requires a join code" },
      { status: 403 }
    );
  }

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

  if (existing) {
    if (!existing.isActive) {
      await db
        .update(communityMemberships)
        .set({ isActive: true, deactivatedAt: null })
        .where(eq(communityMemberships.id, existing.id));
    }
  } else {
    await db.insert(communityMemberships).values({
      communityId: community.id,
      userId: user.id,
      isAdmin: false,
      isCoach: false,
      isActive: true,
    });
  }

  await db
    .update(users)
    .set({ activeCommunityId: community.id, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  return NextResponse.json({
    communityId: community.id,
    name: community.name,
  });
}
