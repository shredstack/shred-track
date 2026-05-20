// /profile/family — member-facing family management page.
//
// Spec §2.1. Server component prefetches the gym context to learn which
// gym the user is in; client-side hydrates the family list via React
// Query. Visibility gated by the family_memberships flag.

import { redirect } from "next/navigation";
import { db } from "@/db";
import { communityMemberships, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { isFlagOn } from "@/lib/feature-flags";
import { listFamilyForAccountHolder } from "@/lib/family";
import { FamilyPageClient } from "./FamilyPageClient";

export const dynamic = "force-dynamic";

export default async function ProfileFamilyPage() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    redirect("/auth");
  }

  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      activeCommunityId: users.activeCommunityId,
    })
    .from(users)
    .where(eq(users.id, sessionUser.id))
    .limit(1);
  if (!user) {
    redirect("/auth");
  }

  const communityId = user.activeCommunityId;
  if (!communityId) {
    return (
      <div className="mx-auto max-w-md px-4 py-8">
        <h1 className="mb-4 text-2xl font-bold">Family</h1>
        <p className="text-sm text-muted-foreground">
          Join a gym to manage family memberships.
        </p>
      </div>
    );
  }

  // Confirm membership.
  const [membership] = await db
    .select({ isActive: communityMemberships.isActive })
    .from(communityMemberships)
    .where(
      and(
        eq(communityMemberships.userId, user.id),
        eq(communityMemberships.communityId, communityId)
      )
    )
    .limit(1);
  if (!membership) {
    redirect("/profile");
  }

  const flagOn = await isFlagOn("family_memberships", {
    userId: user.id,
    communityId,
  });
  if (!flagOn) {
    redirect("/profile");
  }

  const initialFamily = await listFamilyForAccountHolder(user.id, communityId);
  // Strip non-serializable Date fields before handing to a client component.
  const serializableFamily = initialFamily.map((f) => ({
    ...f,
    createdAt: f.createdAt.toISOString(),
  }));

  return (
    <FamilyPageClient
      communityId={communityId}
      accountHolderName={user.name}
      accountHolderEmail={user.email}
      initialFamily={serializableFamily}
    />
  );
}
