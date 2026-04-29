// ============================================
// Crossfit Insights Cache
// ============================================
//
// Backed by `crossfit_insights_cache` (one row per user). Used by the
// domain-profile endpoint to avoid recomputing on every read.
//
// Invalidation strategy (spec §9.5):
//   - Score writes call `invalidateCrossfitInsightsCache(userId)` to drop
//     the row in-process.
//   - On read, even if the row exists, we compare `source_score_count`
//     against the live count and recompute on mismatch — this covers writes
//     that bypassed the API (e.g. seed scripts, admin tooling).
//   - Time fallback: anything older than 24h recomputes regardless.

import { db } from "@/db";
import { crossfitInsightsCache, scores } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import type { DomainProfile } from "./domain-profile";

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export async function countUserScores(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(scores)
    .where(eq(scores.userId, userId));
  return row?.count ?? 0;
}

export async function readCachedDomainProfile(
  userId: string,
  liveScoreCount: number
): Promise<DomainProfile | null> {
  const [row] = await db
    .select()
    .from(crossfitInsightsCache)
    .where(eq(crossfitInsightsCache.userId, userId))
    .limit(1);

  if (!row) return null;
  if (row.sourceScoreCount !== liveScoreCount) return null;
  if (Date.now() - row.computedAt.getTime() > STALE_AFTER_MS) return null;

  return row.domainProfile as DomainProfile;
}

export async function writeCachedDomainProfile(
  userId: string,
  profile: DomainProfile,
  sourceScoreCount: number
): Promise<void> {
  await db
    .insert(crossfitInsightsCache)
    .values({
      userId,
      domainProfile: profile,
      sourceScoreCount,
      computedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: crossfitInsightsCache.userId,
      set: {
        domainProfile: profile,
        sourceScoreCount,
        computedAt: new Date(),
      },
    });
}

// Best-effort invalidation. Failures here must not break score writes — log
// and move on. Callers should `await` it but not branch on its outcome.
export async function invalidateCrossfitInsightsCache(
  userId: string
): Promise<void> {
  try {
    await db
      .delete(crossfitInsightsCache)
      .where(eq(crossfitInsightsCache.userId, userId));
  } catch (err) {
    console.warn("crossfit insights cache invalidation failed", err);
  }
}
