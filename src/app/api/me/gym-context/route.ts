// ---------------------------------------------------------------------------
// GET /api/me/gym-context
//
// One-stop shop for the client to figure out:
//   - is the caller a super admin?
//   - which gyms is the caller a member of (and what's their role per gym)?
//   - which gym is currently active for this user?
//
// The header dropdown, /gym admin gating, and per-workout edit-button
// visibility all read from this endpoint via useGymContext().
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { communities, communityMemberships, users } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { isAdminEmail } from "@/lib/admin";

export async function GET() {
  const sessionUser = await getSessionUser();
  if (!sessionUser)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [userRow] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isAdmin: users.isAdmin,
      activeCommunityId: users.activeCommunityId,
      crossfitView: users.crossfitView,
    })
    .from(users)
    .where(eq(users.id, sessionUser.id))
    .limit(1);

  if (!userRow) {
    return NextResponse.json({ error: "User row missing" }, { status: 404 });
  }

  const isSuperAdmin = !!userRow.isAdmin || isAdminEmail(userRow.email);

  // Memberships joined with the community for name + join code (admins see
  // their gym's join code from the dropdown context). logoUrl + primaryColor
  // are included so the header can render branding without a second query.
  const memberships = await db
    .select({
      communityId: communities.id,
      communityName: communities.name,
      joinCode: communities.joinCode,
      logoUrl: communities.logoUrl,
      primaryColor: communities.primaryColor,
      websiteUrl: communities.websiteUrl,
      isAdmin: communityMemberships.isAdmin,
      isCoach: communityMemberships.isCoach,
      isActive: communityMemberships.isActive,
      joinedAt: communityMemberships.joinedAt,
    })
    .from(communityMemberships)
    .innerJoin(
      communities,
      eq(communities.id, communityMemberships.communityId)
    )
    .where(eq(communityMemberships.userId, sessionUser.id));

  // Validate active gym: if the user's stored active gym is no longer one
  // they're an active member of, blank it out so the client falls back to
  // personal mode.
  let activeCommunityId: string | null = userRow.activeCommunityId ?? null;
  if (activeCommunityId) {
    const stillActive = memberships.find(
      (m) => m.communityId === activeCommunityId && m.isActive
    );
    if (!stillActive) {
      activeCommunityId = null;
      // Best-effort cleanup; ignore failures.
      await db
        .update(users)
        .set({ activeCommunityId: null, updatedAt: new Date() })
        .where(eq(users.id, sessionUser.id))
        .catch(() => {});
    }
  }

  return NextResponse.json({
    user: {
      id: userRow.id,
      email: userRow.email,
      name: userRow.name,
      isSuperAdmin,
      // Normalise to the known union so the client type stays honest;
      // anything unexpected falls back to null ("no choice → default").
      crossfitView:
        userRow.crossfitView === "gym" || userRow.crossfitView === "personal"
          ? userRow.crossfitView
          : null,
    },
    activeCommunityId,
    memberships: memberships.map((m) => ({
      communityId: m.communityId,
      communityName: m.communityName,
      // Only admins of the gym should see the join code in the response.
      // Members shouldn't have to be careful about screen-shotting the
      // dropdown.
      joinCode: m.isAdmin || isSuperAdmin ? m.joinCode : null,
      logoUrl: m.logoUrl,
      primaryColor: m.primaryColor,
      websiteUrl: m.websiteUrl,
      isAdmin: m.isAdmin,
      isCoach: m.isCoach,
      isActive: m.isActive,
      joinedAt: m.joinedAt,
    })),
  });
}
