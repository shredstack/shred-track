// ---------------------------------------------------------------------------
// Recovery authorization helpers — mirrors lib/authz/workout.ts.
//
// Movements are visible if validated + system, validated + user-promoted,
// or owned by the caller. Gym-scoped resources require active membership
// and (for edit/program) coach-or-admin role.
// ---------------------------------------------------------------------------

import { and, eq, or, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  recoveryMovements,
  recoveryRoutines,
  recoverySchedules,
  recoverySessions,
  communityMemberships,
} from "@/db/schema";
import { canProgramForGym, isSuperAdmin, getGymRole } from "./community";

export interface RecoveryAccess {
  exists: boolean;
  canRead: boolean;
  canEdit: boolean;
  isGymScoped: boolean;
  communityId: string | null;
}

// SQL fragment usable as a WHERE clause for visible recovery movements.
// Caller passes their userId. The fragment captures: system rows, validated
// user-promoted rows, and the caller's own (possibly unvalidated) rows.
export function visibleMovementCondition(userId: string) {
  return or(
    and(isNull(recoveryMovements.createdBy), eq(recoveryMovements.isValidated, true)),
    and(eq(recoveryMovements.isValidated, true)),
    eq(recoveryMovements.createdBy, userId)
  )!;
}

export async function canCreateGymRoutine(
  userId: string,
  communityId: string | null
): Promise<boolean> {
  if (communityId === null) return true;
  return canProgramForGym(userId, communityId);
}

export async function canValidateMovement(
  userId: string,
  submitterCommunityId: string | null
): Promise<boolean> {
  if (await isSuperAdmin(userId)) return true;
  if (!submitterCommunityId) return false;
  return canProgramForGym(userId, submitterCommunityId);
}

export async function canEditGymOverride(
  userId: string,
  communityId: string
): Promise<boolean> {
  return canProgramForGym(userId, communityId);
}

export async function canCreateGymSchedule(
  userId: string,
  communityId: string | null
): Promise<boolean> {
  if (communityId === null) return true;
  return canProgramForGym(userId, communityId);
}

export async function getScheduleAccess(
  userId: string,
  scheduleId: string
): Promise<RecoveryAccess> {
  const [s] = await db
    .select({
      createdBy: recoverySchedules.createdBy,
      communityId: recoverySchedules.communityId,
    })
    .from(recoverySchedules)
    .where(eq(recoverySchedules.id, scheduleId))
    .limit(1);

  if (!s) {
    return { exists: false, canRead: false, canEdit: false, isGymScoped: false, communityId: null };
  }

  if (s.communityId === null) {
    const isOwner = s.createdBy === userId;
    return {
      exists: true,
      canRead: isOwner,
      canEdit: isOwner,
      isGymScoped: false,
      communityId: null,
    };
  }

  if (await isSuperAdmin(userId)) {
    return { exists: true, canRead: true, canEdit: true, isGymScoped: true, communityId: s.communityId };
  }

  const role = await getGymRole(userId, s.communityId);
  if (!role || !role.isActive) {
    return { exists: true, canRead: false, canEdit: false, isGymScoped: true, communityId: s.communityId };
  }

  return {
    exists: true,
    canRead: true,
    canEdit: role.isAdmin || role.isCoach,
    isGymScoped: true,
    communityId: s.communityId,
  };
}

export async function getRoutineAccess(
  userId: string,
  routineId: string
): Promise<RecoveryAccess> {
  const [r] = await db
    .select({
      createdBy: recoveryRoutines.createdBy,
      communityId: recoveryRoutines.communityId,
      isValidated: recoveryRoutines.isValidated,
    })
    .from(recoveryRoutines)
    .where(eq(recoveryRoutines.id, routineId))
    .limit(1);

  if (!r) {
    return { exists: false, canRead: false, canEdit: false, isGymScoped: false, communityId: null };
  }

  if (await isSuperAdmin(userId)) {
    return { exists: true, canRead: true, canEdit: true, isGymScoped: !!r.communityId, communityId: r.communityId };
  }

  if (r.communityId === null) {
    if (r.createdBy === userId) {
      return { exists: true, canRead: true, canEdit: true, isGymScoped: false, communityId: null };
    }
    return {
      exists: true,
      canRead: r.isValidated,
      canEdit: false,
      isGymScoped: false,
      communityId: null,
    };
  }

  const role = await getGymRole(userId, r.communityId);
  if (!role || !role.isActive) {
    return { exists: true, canRead: false, canEdit: false, isGymScoped: true, communityId: r.communityId };
  }
  return {
    exists: true,
    canRead: true,
    canEdit: role.isAdmin || role.isCoach,
    isGymScoped: true,
    communityId: r.communityId,
  };
}

export interface RecoveryMovementAccess {
  exists: boolean;
  canRead: boolean;
  canEdit: boolean;
  canValidate: boolean;
  isOwn: boolean;
  isValidated: boolean;
  createdBy: string | null;
}

export async function getMovementAccess(
  userId: string,
  movementId: string
): Promise<RecoveryMovementAccess> {
  const [m] = await db
    .select({
      createdBy: recoveryMovements.createdBy,
      isValidated: recoveryMovements.isValidated,
    })
    .from(recoveryMovements)
    .where(eq(recoveryMovements.id, movementId))
    .limit(1);

  if (!m) {
    return { exists: false, canRead: false, canEdit: false, canValidate: false, isOwn: false, isValidated: false, createdBy: null };
  }

  const isOwn = m.createdBy === userId;
  const superAdmin = await isSuperAdmin(userId);
  const validated = m.isValidated;

  // Read: validated rows are public; unvalidated ones only to owner or admins.
  const canRead = validated || isOwn || superAdmin;

  // Edit: super admin always; owner only while unvalidated.
  const canEdit = superAdmin || (isOwn && !validated);

  // Validate: super admin always; coach/admin only of submitter's gym (we
  // don't track submitter's gym in this row, so coaches can validate any
  // unvalidated submission — defense-in-depth handled by the route which
  // double-checks the submitter's active gym membership).
  const canValidate = superAdmin || !validated;

  return {
    exists: true,
    canRead,
    canEdit,
    canValidate,
    isOwn,
    isValidated: validated,
    createdBy: m.createdBy ?? null,
  };
}

// Shape used by sessions to validate read access by both the owner and
// coaches of the schedule's gym.
export async function canReadSession(
  userId: string,
  sessionId: string
): Promise<boolean> {
  const [s] = await db
    .select({
      ownerId: recoverySessions.userId,
      scheduleId: recoverySessions.scheduleId,
    })
    .from(recoverySessions)
    .where(eq(recoverySessions.id, sessionId))
    .limit(1);
  if (!s) return false;
  if (s.ownerId === userId) return true;
  if (await isSuperAdmin(userId)) return true;
  if (!s.scheduleId) return false;
  const access = await getScheduleAccess(userId, s.scheduleId);
  return access.canEdit; // coach/admin of the gym can read for adherence
}

export async function isActiveMember(
  userId: string,
  communityId: string
): Promise<boolean> {
  if (await isSuperAdmin(userId)) return true;
  const [m] = await db
    .select({ isActive: communityMemberships.isActive })
    .from(communityMemberships)
    .where(
      and(
        eq(communityMemberships.userId, userId),
        eq(communityMemberships.communityId, communityId)
      )
    )
    .limit(1);
  return !!m?.isActive;
}
