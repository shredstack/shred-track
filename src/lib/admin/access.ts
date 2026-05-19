// ---------------------------------------------------------------------------
// Admin access — single source of truth for "can this user enter /admin?"
//
// Two tiers of admin access:
//   - Super admin (users.is_admin or ADMIN_EMAILS env override): sees every
//     tool in /admin.
//   - Gym admin/coach (active row in community_memberships with isAdmin or
//     isCoach): sees only the non-super-only tools (movements, benchmarks,
//     recovery movements).
//
// Pair this with useAdminAccess() on the client. Both call sites use the
// same shape so UI conditionals and server gates stay in sync.
// ---------------------------------------------------------------------------

import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { communityMemberships, users } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { isAdminEmail } from "@/lib/admin";

type SessionUser = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;

export interface AdminAccess {
  user: SessionUser;
  isSuperAdmin: boolean;
  /** True for super admins and for active gym admins/coaches. */
  canAccessAdmin: boolean;
}

/**
 * Returns the caller's admin access tier, or null if they have no access
 * (no session, or session user is neither super admin nor an active gym
 * coach/admin). Layouts use the null branch to redirect; API routes that
 * accept gym coaches/admins (e.g. /api/admin/movements) use it for auth.
 */
export async function getAdminAccess(): Promise<AdminAccess | null> {
  const user = await getSessionUser();
  if (!user) return null;

  // Super admin check: env bootstrap or DB flag.
  const envSuper = isAdminEmail(user.email);
  const [row] = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  const isSuperAdmin = envSuper || !!row?.isAdmin;

  if (isSuperAdmin) {
    return { user, isSuperAdmin: true, canAccessAdmin: true };
  }

  // Otherwise: at least one active gym membership with a staff role.
  const [staffRow] = await db
    .select({ id: communityMemberships.id })
    .from(communityMemberships)
    .where(
      and(
        eq(communityMemberships.userId, user.id),
        eq(communityMemberships.isActive, true),
        or(
          eq(communityMemberships.isAdmin, true),
          eq(communityMemberships.isCoach, true)
        )
      )
    )
    .limit(1);

  if (!staffRow) return null;

  return { user, isSuperAdmin: false, canAccessAdmin: true };
}
