// ---------------------------------------------------------------------------
// Workout authorization helpers.
//
// Personal workouts (community_id IS NULL) are visible/editable only by
// the creator. Gym workouts (community_id IS NOT NULL) are visible to all
// active members of the gym, but editable only by coaches/admins of that
// gym (or the super admin).
// ---------------------------------------------------------------------------

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  communityMemberships,
  workoutSessions,
  workouts,
} from "@/db/schema";
import { canProgramForGym, isSuperAdmin } from "./community";

export interface WorkoutAccess {
  /** Workout exists. */
  exists: boolean;
  /** Caller can read this workout. */
  canRead: boolean;
  /** Caller can edit/delete this workout. */
  canEdit: boolean;
  /** True when the workout is a gym workout (has communityId). */
  isGymWorkout: boolean;
  /** The gym id, or null for personal workouts. */
  communityId: string | null;
}

/** Authoritative workout access decision. One DB hit for the workout row,
 *  plus at most one membership lookup for gym workouts. */
export async function getWorkoutAccess(
  userId: string,
  workoutId: string
): Promise<WorkoutAccess> {
  const [w] = await db
    .select({
      createdBy: workouts.createdBy,
      communityId: workouts.communityId,
    })
    .from(workouts)
    .where(eq(workouts.id, workoutId))
    .limit(1);

  if (!w) {
    return {
      exists: false,
      canRead: false,
      canEdit: false,
      isGymWorkout: false,
      communityId: null,
    };
  }

  // Personal workout: only the creator can touch it.
  if (w.communityId === null) {
    const isOwner = w.createdBy === userId;
    return {
      exists: true,
      canRead: isOwner,
      canEdit: isOwner,
      isGymWorkout: false,
      communityId: null,
    };
  }

  // Gym workout. Super admin first to short-circuit a membership lookup.
  if (await isSuperAdmin(userId)) {
    return {
      exists: true,
      canRead: true,
      canEdit: true,
      isGymWorkout: true,
      communityId: w.communityId,
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
        eq(communityMemberships.communityId, w.communityId),
        eq(communityMemberships.userId, userId)
      )
    )
    .limit(1);

  if (!m || !m.isActive) {
    return {
      exists: true,
      canRead: false,
      canEdit: false,
      isGymWorkout: true,
      communityId: w.communityId,
    };
  }

  const canEdit = m.isAdmin || m.isCoach;
  return {
    exists: true,
    canRead: true,
    canEdit,
    isGymWorkout: true,
    communityId: w.communityId,
  };
}

/** Convenience for create-time. Personal workouts are always allowed; gym
 *  workouts require coach/admin in the target gym. */
export async function canCreateWorkoutInGym(
  userId: string,
  communityId: string | null
): Promise<boolean> {
  if (communityId === null) return true;
  return canProgramForGym(userId, communityId);
}

// ---------------------------------------------------------------------------
// Unified-schema session access.
//
// Workouts collapse into sessions in the new schema, so the routes that
// used to call `getWorkoutAccess` against a `workouts.id` now resolve a
// `workout_sessions.id`. The decision tree is identical:
//   • personal session (user_id set)         → only the session owner
//   • gym session (community_id set)         → super-admin OR coach/admin
//                                              of that gym
// ---------------------------------------------------------------------------

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
