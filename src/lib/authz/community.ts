// ---------------------------------------------------------------------------
// Community / gym authorization helpers.
//
// One source of truth for "what can this user do in this gym?" Used by API
// routes (defense in depth) and by the client through /api/me/gym-context
// to decide which buttons to show.
// ---------------------------------------------------------------------------

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { communityMemberships, users } from "@/db/schema";

export interface GymRole {
  isAdmin: boolean;
  isCoach: boolean;
  isActive: boolean;
}

/** Returns the user's role flags in a gym, or null if they're not a member. */
export async function getGymRole(
  userId: string,
  communityId: string
): Promise<GymRole | null> {
  const [m] = await db
    .select({
      isAdmin: communityMemberships.isAdmin,
      isCoach: communityMemberships.isCoach,
      isActive: communityMemberships.isActive,
    })
    .from(communityMemberships)
    .where(
      and(
        eq(communityMemberships.communityId, communityId),
        eq(communityMemberships.userId, userId)
      )
    )
    .limit(1);
  return m ?? null;
}

/** Super-admin shortcut. Mirrors lib/admin.ts but without the env check
 *  duplication — env-bootstrap admins are also flagged users.is_admin in
 *  practice, but this helper falls back to a DB read. */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return !!row?.isAdmin;
}

/** True if the user is an active coach or admin of the gym (or super admin). */
export async function canProgramForGym(
  userId: string,
  communityId: string
): Promise<boolean> {
  if (await isSuperAdmin(userId)) return true;
  const role = await getGymRole(userId, communityId);
  return !!role && role.isActive && (role.isAdmin || role.isCoach);
}

/**
 * True if the user can manage a gym — coach or admin (or super admin).
 * Alias of canProgramForGym. The CFD readiness spec consistently calls this
 * `canManageGym`; keeping both names so callers can use whichever reads
 * better at the call site.
 */
export const canManageGym = canProgramForGym;

/** True if the user is an active gym admin (or super admin). */
export async function canAdminGym(
  userId: string,
  communityId: string
): Promise<boolean> {
  if (await isSuperAdmin(userId)) return true;
  const role = await getGymRole(userId, communityId);
  return !!role && role.isActive && role.isAdmin;
}

/** True if the user is an active member of the gym (any role; or super admin). */
export async function canViewGym(
  userId: string,
  communityId: string
): Promise<boolean> {
  if (await isSuperAdmin(userId)) return true;
  const role = await getGymRole(userId, communityId);
  return !!role && role.isActive;
}
