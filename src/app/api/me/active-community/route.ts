// ---------------------------------------------------------------------------
// POST /api/me/active-community
//
// Body: { communityId: string | null }
// Sets the user's active gym pointer. Null means "personal mode".
// 403 if the user is not an active member of the requested gym.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { communityMemberships, users } from "@/db/schema";
import { getSessionUser } from "@/lib/session";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const communityId =
    body && typeof body.communityId === "string" ? body.communityId : null;

  if (communityId) {
    const [m] = await db
      .select({ isActive: communityMemberships.isActive })
      .from(communityMemberships)
      .where(
        and(
          eq(communityMemberships.communityId, communityId),
          eq(communityMemberships.userId, user.id)
        )
      )
      .limit(1);
    if (!m || !m.isActive) {
      return NextResponse.json(
        { error: "Not an active member of this gym" },
        { status: 403 }
      );
    }
  }

  await db
    .update(users)
    .set({ activeCommunityId: communityId, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  return NextResponse.json({ activeCommunityId: communityId });
}
