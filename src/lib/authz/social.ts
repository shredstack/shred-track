// ---------------------------------------------------------------------------
// Social authorization helpers.
//
// Mirror `getWorkoutAccess` in style — one DB hit each, no chained joins.
// Used by the reactions, comments, and notification endpoints.
// ---------------------------------------------------------------------------

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  scores,
  workouts,
  workoutParts,
  communityMemberships,
} from "@/db/schema";
import { canViewGym, isSuperAdmin } from "./community";

export interface ScoreContext {
  scoreId: string;
  userId: string;
  workoutId: string;
  workoutPartId: string | null;
  communityId: string | null;
}

/** Lookup the workout / gym context for a score. Returns null if missing. */
export async function loadScoreContext(
  scoreId: string
): Promise<ScoreContext | null> {
  const [row] = await db
    .select({
      scoreId: scores.id,
      userId: scores.userId,
      workoutId: scores.workoutId,
      workoutPartId: scores.workoutPartId,
      communityId: workouts.communityId,
    })
    .from(scores)
    .innerJoin(workouts, eq(workouts.id, scores.workoutId))
    .where(eq(scores.id, scoreId))
    .limit(1);
  return row ?? null;
}

/** Caller can view this score iff they can view its workout. */
export async function canViewScore(
  userId: string,
  scoreId: string
): Promise<boolean> {
  const ctx = await loadScoreContext(scoreId);
  if (!ctx) return false;
  // Personal workout: only the score owner (== workout owner in v1) sees it.
  if (ctx.communityId === null) return ctx.userId === userId;
  // Gym workout: any active member can view.
  return canViewGym(userId, ctx.communityId);
}

/** Caller can interact (react / comment) on this score iff they're an
 *  active member of the score's workout's gym. Personal workouts return
 *  false in v1. */
export async function canInteractWithScore(
  userId: string,
  scoreId: string
): Promise<{ allowed: boolean; ctx: ScoreContext | null }> {
  const ctx = await loadScoreContext(scoreId);
  if (!ctx) return { allowed: false, ctx: null };
  // Personal scores are out of scope for social features in v1.
  if (ctx.communityId === null) return { allowed: false, ctx };
  const allowed = await canViewGym(userId, ctx.communityId);
  return { allowed, ctx };
}

/** True iff every userId in `mentionedUserIds` is an active member of
 *  `communityId`. Returns the offending ids so the API can surface them.
 *  Super admin is treated as an active member for the purposes of being
 *  *mentioned* — they can lurk in any gym and we don't want to reject. */
export async function validateMentionTargets(
  mentionedUserIds: string[],
  communityId: string
): Promise<{ valid: boolean; invalid: string[] }> {
  if (mentionedUserIds.length === 0) return { valid: true, invalid: [] };

  const rows = await db
    .select({ userId: communityMemberships.userId })
    .from(communityMemberships)
    .where(
      and(
        eq(communityMemberships.communityId, communityId),
        eq(communityMemberships.isActive, true),
        inArray(communityMemberships.userId, mentionedUserIds)
      )
    );
  const activeSet = new Set(rows.map((r) => r.userId));

  // Super admins are allowed targets even without an active membership row.
  const invalid: string[] = [];
  for (const id of mentionedUserIds) {
    if (activeSet.has(id)) continue;
    if (await isSuperAdmin(id)) continue;
    invalid.push(id);
  }
  return { valid: invalid.length === 0, invalid };
}

// Re-exported here so importers don't need to pull from multiple modules.
export { workoutParts };
