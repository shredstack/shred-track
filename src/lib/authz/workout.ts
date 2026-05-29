// ---------------------------------------------------------------------------
// Session authorization helpers.
//
// Workouts collapse into sessions in the unified schema. Personal
// sessions (user_id set) are visible/editable only by the owner. Gym
// sessions (community_id set) are visible to active members and editable
// by coaches/admins of that gym (or the super admin).
// ---------------------------------------------------------------------------

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { communityMemberships, workoutSessions } from "@/db/schema";
import { canProgramForGym, isSuperAdmin } from "./community";

/** Convenience for create-time. Personal sessions are always allowed; gym
 *  sessions require coach/admin in the target gym. */
export async function canCreateWorkoutInGym(
  userId: string,
  communityId: string | null
): Promise<boolean> {
  if (communityId === null) return true;
  return canProgramForGym(userId, communityId);
}

export interface SessionAccess {
  /** Session row exists. */
  exists: boolean;
  /** Caller can read this session. */
  canRead: boolean;
  /** Caller can edit/delete this session. */
  canEdit: boolean;
  /** True when the session is scoped to a gym. */
  isGymSession: boolean;
  /** The gym id, or null for personal sessions. */
  communityId: string | null;
}

export async function getSessionAccess(
  userId: string,
  sessionId: string
): Promise<SessionAccess> {
  const [s] = await db
    .select({
      userId: workoutSessions.userId,
      communityId: workoutSessions.communityId,
    })
    .from(workoutSessions)
    .where(eq(workoutSessions.id, sessionId))
    .limit(1);

  if (!s) {
    return {
      exists: false,
      canRead: false,
      canEdit: false,
      isGymSession: false,
      communityId: null,
    };
  }

  // Personal session: only the owner can read or edit.
  if (s.communityId === null) {
    const isOwner = s.userId === userId;
    return {
      exists: true,
      canRead: isOwner,
      canEdit: isOwner,
      isGymSession: false,
      communityId: null,
    };
  }

  // Gym session. Super admin short-circuits the membership lookup.
  if (await isSuperAdmin(userId)) {
    return {
      exists: true,
      canRead: true,
      canEdit: true,
      isGymSession: true,
      communityId: s.communityId,
    };
  }

  const [m] = await db
    .select({
      isAdmin: communityMemberships.isAdmin,
      isCoach: communityMemberships.isCoach,
      isActive: communityMemberships.isActive,
    })
    .from(communityMemberships)
    .where(
      and(
        eq(communityMemberships.communityId, s.communityId),
        eq(communityMemberships.userId, userId)
      )
    )
    .limit(1);

  if (!m || !m.isActive) {
    return {
      exists: true,
      canRead: false,
      canEdit: false,
      isGymSession: true,
      communityId: s.communityId,
    };
  }

  const canEdit = m.isAdmin || m.isCoach;
  return {
    exists: true,
    canRead: true,
    canEdit,
    isGymSession: true,
    communityId: s.communityId,
  };
}
