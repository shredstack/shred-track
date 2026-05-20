// ============================================================
// EPOC preference resolution.
// ============================================================
//
// Cascade (spec §EPOC):
//   1. user.epoc_enabled if non-null → community.epoc_multiplier (or 1.0 off)
//   2. otherwise → community default (enabled? multiplier : 1.0)
//   3. solo users (no community) → user pref, default enabled at 1.10
//
// Returns a single multiplier (>=1.0). Callers pass it straight to the
// estimator; no other branching is required.

import { db } from "@/db";
import { users, communityCaloriePreferences } from "@/db/schema";
import { eq } from "drizzle-orm";

const DEFAULT_EPOC = 1.1;

export async function resolveEpocMultiplier(input: {
  userId: string;
  communityId: string | null;
}): Promise<number> {
  const [user] = await db
    .select({
      epocEnabled: users.epocEnabled,
      activeCommunityId: users.activeCommunityId,
    })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  const communityId = input.communityId ?? user?.activeCommunityId ?? null;
  const community = communityId
    ? await db
        .select()
        .from(communityCaloriePreferences)
        .where(eq(communityCaloriePreferences.communityId, communityId))
        .limit(1)
    : [];

  const communityDefaultEnabled = community[0]?.epocDefaultEnabled ?? true;
  const communityMultiplier = community[0]
    ? Number(community[0].epocMultiplier)
    : DEFAULT_EPOC;

  // Explicit user override.
  if (user?.epocEnabled === true) return communityMultiplier;
  if (user?.epocEnabled === false) return 1.0;
  // Inherit community / solo default.
  return communityDefaultEnabled ? communityMultiplier : 1.0;
}
