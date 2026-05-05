// ---------------------------------------------------------------------------
// /gym section layout — for gym coaches and admins (NOT super admins).
//
// Server component: pulls the user's active gym from `users.active_community_id`
// and verifies coach-or-admin access. Members of a gym (no role) get
// redirected to /. Each child page repeats the role check (defense in
// depth) so a direct API hit can't bypass.
// ---------------------------------------------------------------------------

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canProgramForGym } from "@/lib/authz/community";

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

  const ok = await canProgramForGym(user.id, activeId);
  if (!ok) redirect("/");

  return <div className="space-y-4">{children}</div>;
}
