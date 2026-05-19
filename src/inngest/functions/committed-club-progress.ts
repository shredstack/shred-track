// committed-club-progress (spec §2.5)
//
// Triggered by attendance-mark events emitted from
// /api/classes/[id]/attendance. For thresholds 5, 10, threshold-1, and
// threshold, fires a notification. Special-cases the first month-cross
// at threshold (committed_club_earned) and the unique-rank-1 case.

import { and, eq, sql } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "@/db";
import { communities, notifications } from "@/db/schema";
import { getCurrentMonthProgress, getMonthlyLeaderboard } from "@/lib/committed-club";

export const committedClubProgress = inngest.createFunction(
  {
    id: "committed-club-progress",
    retries: 2,
    triggers: [{ event: "committed-club/attended" }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: { event: any; step: any }) => {
    const { userId, communityId } = event.data as {
      userId: string;
      communityId: string;
    };
    const progress = (await step.run("compute-progress", async () => {
      const [gym] = await db
        .select({ id: communities.id })
        .from(communities)
        .where(eq(communities.id, communityId))
        .limit(1);
      if (!gym) return null;
      return getCurrentMonthProgress(userId, communityId);
    })) as Awaited<ReturnType<typeof getCurrentMonthProgress>> | null;
    if (!progress) return { skipped: "no-gym" };

    const { classesAttended, threshold, qualified, yearMonth } = progress;
    const thresholds = new Set([5, 10, threshold - 1, threshold]);
    if (!thresholds.has(classesAttended)) {
      return { skipped: "not-a-milestone" };
    }

    // For threshold-crossing: emit committed_club_earned. Also check
    // whether the user was already earned this month (prior attended
    // count >= threshold). If so, this is a duplicate (race) — skip.
    const isEarning = classesAttended === threshold && qualified;
    const alreadyNotified = (await step.run("dedup-check", async () => {
      const kind = isEarning ? "committed_club_earned" : "committed_club_progress";
      const [row] = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.recipientId, userId),
            eq(notifications.kind, kind),
            eq(notifications.communityId, communityId),
            sql`${notifications.createdAt} > date_trunc('month', now())`,
            sql`${notifications.createdAt} > date_trunc('day', now())`
          )
        )
        .limit(1);
      return !!row;
    })) as boolean;
    if (alreadyNotified) return { skipped: "duplicate" };

    let rank: number | null = null;
    if (isEarning) {
      const lb = await step.run("compute-rank", async () =>
        getMonthlyLeaderboard(communityId, yearMonth, 1000)
      );
      const r = lb.find((x: { userId: string; rank: number }) => x.userId === userId);
      rank = r?.rank ?? null;
    }

    const [inserted] = (await step.run("insert-notification", async () =>
      db
        .insert(notifications)
        .values({
          recipientId: userId,
          kind: isEarning ? "committed_club_earned" : "committed_club_progress",
          communityId,
        })
        .returning({ id: notifications.id })
    )) as Array<{ id: string }>;

    await step.sendEvent("dispatch-push", {
      name: "notifications/created",
      data: { notificationId: inserted.id },
    });

    return {
      delivered: true,
      kind: isEarning ? "earned" : "progress",
      rank,
    };
  }
);
