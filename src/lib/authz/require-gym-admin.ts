// Server-side guard for /gym/* admin sub-routes. Each admin-only section
// (programming, members, settings, etc.) has a nested layout that awaits
// requireGymAdminOrRedirect() so a member who lands on an admin URL gets
// bounced to /gym/social instead of seeing tools they can't use.
//
// The parent /gym layout only enforces "active member of the current gym",
// so member-facing pages (social feed, committed-club, member-facing
// tracks view) stay reachable without elevation.

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canProgramForGym } from "@/lib/authz/community";

export async function requireGymAdminOrRedirect(): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [row] = await db
    .select({ activeCommunityId: users.activeCommunityId })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  const activeId = row?.activeCommunityId ?? null;
  if (!activeId) redirect("/");

  const ok = await canProgramForGym(user.id, activeId);
  if (!ok) redirect("/gym/social");
}
