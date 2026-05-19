// ---------------------------------------------------------------------------
// /gym section layout.
//
// Gates the entire /gym subtree on "active member of the currently active
// gym". Admin-only pages (programming, members, settings, join-code,
// documents, events, classes, recovery, social/review) each have their
// own nested layout that re-checks coach/admin role via
// requireGymAdminOrRedirect. Member-facing pages (social feed, post
// detail, committed-club, member-facing tracks view) get through this
// layout without elevation.
// ---------------------------------------------------------------------------

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { communityMemberships, users } from "@/db/schema";
import { getSessionUser } from "@/lib/session";

export default async function GymLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [row] = await db
    .select({ activeCommunityId: users.activeCommunityId })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  const activeId = row?.activeCommunityId ?? null;
  if (!activeId) redirect("/");

  const [membership] = await db
    .select({ isActive: communityMemberships.isActive })
    .from(communityMemberships)
    .where(
      and(
        eq(communityMemberships.userId, user.id),
        eq(communityMemberships.communityId, activeId)
      )
    )
    .limit(1);
  if (!membership?.isActive) redirect("/");

  return <div className="space-y-4">{children}</div>;
}
