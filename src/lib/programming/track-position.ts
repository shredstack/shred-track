// Shared positioning helper for sessions sourced from a programming track.
//
// Used by both the publish-time inline injector and the smart-builder /
// free-text track-day write paths so a track session lands in the same
// slot regardless of which path created it. Each branch shifts the
// positions of existing sessions on the day so the returned index is
// the new session's final slot.

import { and, asc, eq, sql } from "drizzle-orm";
import { workoutSessions } from "@/db/schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

export const VALID_INLINE_POSITIONS = [
  "top",
  "after_wod",
  "before_stretching",
  "before_at_home",
  "end_of_day",
] as const;
export type InlinePosition = (typeof VALID_INLINE_POSITIONS)[number];

export function isValidInlinePosition(v: unknown): v is InlinePosition {
  return (
    typeof v === "string" &&
    (VALID_INLINE_POSITIONS as readonly string[]).includes(v)
  );
}

/**
 * Compute the position a new track-sourced session should occupy on a
 * given day, shifting existing sessions as needed. Falls back to
 * end-of-day when the requested anchor (e.g. stretching) doesn't exist.
 *
 * Must run inside a transaction — concurrent inserts on the same day
 * would otherwise race on the shift step.
 */
export async function resolveInlinePosition(
  tx: Tx,
  opts: {
    communityId: string;
    workoutDate: string;
    inlinePosition: InlinePosition;
  }
): Promise<number> {
  const { communityId, workoutDate, inlinePosition } = opts;

  if (inlinePosition === "top") {
    await tx.execute(
      sql`update workout_sessions set position = position + 1
          where community_id = ${communityId}
            and workout_date = ${workoutDate}`
    );
    return 0;
  }

  if (inlinePosition === "after_wod") {
    const wod = await tx
      .select({ position: workoutSessions.position })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.communityId, communityId),
          eq(workoutSessions.workoutDate, workoutDate),
          eq(workoutSessions.kind, "wod")
        )
      )
      .orderBy(asc(workoutSessions.position))
      .limit(1);
    const position = (wod[0]?.position ?? 0) + 1;
    await tx.execute(
      sql`update workout_sessions set position = position + 1
          where community_id = ${communityId}
            and workout_date = ${workoutDate}
            and position >= ${position}`
    );
    return position;
  }

  if (inlinePosition === "before_stretching") {
    const stretching = await tx
      .select({ position: workoutSessions.position })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.communityId, communityId),
          eq(workoutSessions.workoutDate, workoutDate),
          eq(workoutSessions.kind, "stretching")
        )
      )
      .orderBy(asc(workoutSessions.position))
      .limit(1);
    if (stretching.length > 0) {
      const position = stretching[0].position;
      await tx.execute(
        sql`update workout_sessions set position = position + 1
            where community_id = ${communityId}
              and workout_date = ${workoutDate}
              and position >= ${position}`
      );
      return position;
    }
    // Anchor missing — fall through to end-of-day so the section still
    // surfaces somewhere instead of getting buried at the top.
  } else if (inlinePosition === "before_at_home") {
    const atHome = await tx
      .select({ position: workoutSessions.position })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.communityId, communityId),
          eq(workoutSessions.workoutDate, workoutDate),
          eq(workoutSessions.kind, "at_home")
        )
      )
      .orderBy(asc(workoutSessions.position))
      .limit(1);
    if (atHome.length > 0) {
      const position = atHome[0].position;
      await tx.execute(
        sql`update workout_sessions set position = position + 1
            where community_id = ${communityId}
              and workout_date = ${workoutDate}
              and position >= ${position}`
      );
      return position;
    }
  }

  // end_of_day or anchor-missing fallback.
  const [maxRow] = await tx
    .select({
      max: sql<number>`coalesce(max(${workoutSessions.position}), -1)::int`,
    })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.communityId, communityId),
        eq(workoutSessions.workoutDate, workoutDate)
      )
    );
  return (maxRow?.max ?? -1) + 1;
}
