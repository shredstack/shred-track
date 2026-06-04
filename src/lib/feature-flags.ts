// ---------------------------------------------------------------------------
// Feature flag resolver.
//
// Resolution order (highest priority first):
//   1. user override   (user_feature_overrides)
//   2. community override (community_feature_overrides for activeCommunityId)
//   3. default_value   (feature_flags registry)
//
// Memoized per request via React's cache() so a server-rendered page that
// reads several flags only issues one query. The client uses the
// /api/me/feature-flags endpoint + useFeatureFlag() hook instead.
// ---------------------------------------------------------------------------

import { cache } from "react";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  featureFlags,
  communityFeatureOverrides,
  userFeatureOverrides,
} from "@/db/schema";

export interface FlagContext {
  userId?: string | null;
  communityId?: string | null;
}

export type FlagValue = unknown;
export type FlagMap = Record<string, FlagValue>;

/**
 * Internal: load the full flag map for a (userId, communityId) tuple in one
 * round-trip and cache it for the request. We always load every flag because
 * the admin UI + hook want the complete map anyway.
 */
const loadAllFlags = cache(
  async (
    userId: string | null,
    communityId: string | null
  ): Promise<FlagMap> => {
    const defaults = await db
      .select({ key: featureFlags.key, value: featureFlags.defaultValue })
      .from(featureFlags);

    const result: FlagMap = {};
    for (const row of defaults) result[row.key] = row.value;

    if (communityId) {
      const gymOverrides = await db
        .select({
          key: communityFeatureOverrides.flagKey,
          value: communityFeatureOverrides.value,
        })
        .from(communityFeatureOverrides)
        .where(eq(communityFeatureOverrides.communityId, communityId));
      for (const row of gymOverrides) result[row.key] = row.value;
    }

    if (userId) {
      const userOverrides = await db
        .select({
          key: userFeatureOverrides.flagKey,
          value: userFeatureOverrides.value,
        })
        .from(userFeatureOverrides)
        .where(eq(userFeatureOverrides.userId, userId));
      for (const row of userOverrides) result[row.key] = row.value;
    }

    return result;
  }
);

/** Resolve a single flag for the given (userId, communityId) context. */
export async function getFlag<T = FlagValue>(
  key: string,
  ctx: FlagContext
): Promise<T | undefined> {
  const map = await loadAllFlags(ctx.userId ?? null, ctx.communityId ?? null);
  return map[key] as T | undefined;
}

/** Boolean convenience wrapper. Treats `true` (any truthy JSON) as on. */
export async function isFlagOn(
  key: string,
  ctx: FlagContext
): Promise<boolean> {
  const v = await getFlag(key, ctx);
  return v === true || v === "true" || v === 1;
}

/** Returns the full resolved flag map. Used by /api/me/feature-flags. */
export async function getAllFlags(ctx: FlagContext): Promise<FlagMap> {
  return loadAllFlags(ctx.userId ?? null, ctx.communityId ?? null);
}

/**
 * Batched per-recipient flag resolution. Returns the subset of `userIds`
 * for whom `key` resolves to a truthy value under the (communityId,
 * recipient) context. Resolution order matches the single-context path:
 * user override → community override → default.
 *
 * Uses 3 queries regardless of recipient count, so a 500-member gym fan-out
 * still hits the DB three times instead of 500. Intended for notification
 * fan-outs that need to honour individual opt-in/opt-out overrides.
 */
export async function filterRecipientsByFlag(
  key: string,
  communityId: string | null,
  userIds: string[]
): Promise<string[]> {
  if (userIds.length === 0) return [];

  const [defaultRow] = await db
    .select({ value: featureFlags.defaultValue })
    .from(featureFlags)
    .where(eq(featureFlags.key, key))
    .limit(1);
  let baseValue: FlagValue = defaultRow?.value ?? false;

  if (communityId) {
    const [communityRow] = await db
      .select({ value: communityFeatureOverrides.value })
      .from(communityFeatureOverrides)
      .where(
        and(
          eq(communityFeatureOverrides.flagKey, key),
          eq(communityFeatureOverrides.communityId, communityId)
        )
      )
      .limit(1);
    if (communityRow) baseValue = communityRow.value;
  }

  const userRows = await db
    .select({
      userId: userFeatureOverrides.userId,
      value: userFeatureOverrides.value,
    })
    .from(userFeatureOverrides)
    .where(
      and(
        eq(userFeatureOverrides.flagKey, key),
        inArray(userFeatureOverrides.userId, userIds)
      )
    );
  const userMap = new Map(userRows.map((r) => [r.userId, r.value]));

  const isOn = (v: FlagValue) => v === true || v === "true" || v === 1;
  return userIds.filter((id) => isOn(userMap.get(id) ?? baseValue));
}

/**
 * Bulk-fetch the per-gym matrix for the admin UI: returns
 * `{ flags, gyms, overrides[communityId][flagKey] }` so the table can render
 * one row per flag and one column per gym.
 */
export async function getFlagAdminMatrix(): Promise<{
  flags: Array<{
    key: string;
    description: string | null;
    defaultValue: FlagValue;
    isPerGym: boolean;
    isPerUser: boolean;
    isGymAdminConfigurable: boolean;
  }>;
  overrides: Record<string, Record<string, FlagValue>>; // communityId → flagKey → value
}> {
  const flagRows = await db
    .select({
      key: featureFlags.key,
      description: featureFlags.description,
      defaultValue: featureFlags.defaultValue,
      isPerGym: featureFlags.isPerGym,
      isPerUser: featureFlags.isPerUser,
      isGymAdminConfigurable: featureFlags.isGymAdminConfigurable,
    })
    .from(featureFlags);

  const overrideRows = await db
    .select({
      communityId: communityFeatureOverrides.communityId,
      flagKey: communityFeatureOverrides.flagKey,
      value: communityFeatureOverrides.value,
    })
    .from(communityFeatureOverrides);

  const overrides: Record<string, Record<string, FlagValue>> = {};
  for (const row of overrideRows) {
    if (!overrides[row.communityId]) overrides[row.communityId] = {};
    overrides[row.communityId][row.flagKey] = row.value;
  }

  return { flags: flagRows, overrides };
}

/**
 * Limited flag view for a single gym, used by gym admins/coaches. Returns
 * only flags marked `isGymAdminConfigurable` plus that gym's current
 * overrides — never any other gym's data.
 */
export async function getGymAdminFlagView(communityId: string): Promise<{
  flags: Array<{
    key: string;
    description: string | null;
    defaultValue: FlagValue;
    isPerGym: boolean;
    isPerUser: boolean;
    isGymAdminConfigurable: boolean;
  }>;
  overrides: Record<string, FlagValue>; // flagKey → value, for this gym only
}> {
  const flags = await db
    .select({
      key: featureFlags.key,
      description: featureFlags.description,
      defaultValue: featureFlags.defaultValue,
      isPerGym: featureFlags.isPerGym,
      isPerUser: featureFlags.isPerUser,
      isGymAdminConfigurable: featureFlags.isGymAdminConfigurable,
    })
    .from(featureFlags)
    .where(eq(featureFlags.isGymAdminConfigurable, true))
    .orderBy(featureFlags.key);

  const overrideRows = await db
    .select({
      flagKey: communityFeatureOverrides.flagKey,
      value: communityFeatureOverrides.value,
    })
    .from(communityFeatureOverrides)
    .where(eq(communityFeatureOverrides.communityId, communityId));

  const overrides: Record<string, FlagValue> = {};
  for (const row of overrideRows) overrides[row.flagKey] = row.value;

  return { flags, overrides };
}

/**
 * Returns a flag's gating booleans, or null if the key is unknown. Used by
 * the API to decide whether a gym admin is allowed to change a given flag.
 */
export async function getFlagGate(
  key: string
): Promise<{ isPerGym: boolean; isGymAdminConfigurable: boolean } | null> {
  const [row] = await db
    .select({
      isPerGym: featureFlags.isPerGym,
      isGymAdminConfigurable: featureFlags.isGymAdminConfigurable,
    })
    .from(featureFlags)
    .where(eq(featureFlags.key, key))
    .limit(1);
  return row ?? null;
}

/** Set or unset a community override. Pass `value: null` to clear. */
export async function setCommunityFlagOverride(
  communityId: string,
  flagKey: string,
  value: FlagValue | null
): Promise<void> {
  if (value === null) {
    await db
      .delete(communityFeatureOverrides)
      .where(
        and(
          eq(communityFeatureOverrides.communityId, communityId),
          eq(communityFeatureOverrides.flagKey, flagKey)
        )
      );
    return;
  }
  await db
    .insert(communityFeatureOverrides)
    .values({ communityId, flagKey, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [
        communityFeatureOverrides.communityId,
        communityFeatureOverrides.flagKey,
      ],
      set: { value, updatedAt: new Date() },
    });
}

/** Set or unset a user override. Pass `value: null` to clear. */
export async function setUserFlagOverride(
  userId: string,
  flagKey: string,
  value: FlagValue | null
): Promise<void> {
  if (value === null) {
    await db
      .delete(userFeatureOverrides)
      .where(
        and(
          eq(userFeatureOverrides.userId, userId),
          eq(userFeatureOverrides.flagKey, flagKey)
        )
      );
    return;
  }
  await db
    .insert(userFeatureOverrides)
    .values({ userId, flagKey, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [userFeatureOverrides.userId, userFeatureOverrides.flagKey],
      set: { value, updatedAt: new Date() },
    });
}

/** Used by the admin matrix UI; not exported elsewhere. */
export async function getKnownFlagKeys(): Promise<string[]> {
  const rows = await db.select({ key: featureFlags.key }).from(featureFlags);
  return rows.map((r) => r.key);
}
