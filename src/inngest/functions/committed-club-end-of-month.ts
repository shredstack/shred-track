// committed-club-end-of-month (spec §2.5)
//
// Runs hourly. For each gym, if today (gym-local) is the 1st of the
// month AND the local hour is 01, snapshot last month's leaderboard
// into committed_club_snapshots and bump user_streak_cache. Then fire
// committed_club_streak notifications for members with a streak >= 2.

import { eq } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "@/db";
import {
  communities,
  committedClubSnapshots,
  notifications,
  userStreakCache,
} from "@/db/schema";
import { getMonthlyLeaderboard, gymMonthBounds } from "@/lib/committed-club";

export const committedClubEndOfMonth = inngest.createFunction(
  {
    id: "committed-club-end-of-month",
    retries: 1,
    triggers: [{ cron: "0 * * * *" }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ step }: { step: any }) => {
    const now = new Date();

    const gyms = (await step.run("list-gyms", async () =>
      db
        .select({
          id: communities.id,
          timezone: communities.gymTimezone,
          threshold: communities.committedClubThreshold,
        })
        .from(communities)
    )) as Array<{ id: string; timezone: string; threshold: number }>;

    let snapshotted = 0;
    let notified = 0;

    for (const gym of gyms) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: gym.timezone,
        day: "2-digit",
        hour: "2-digit",
        hour12: false,
      }).formatToParts(now);
      const day = Number(parts.find((p) => p.type === "day")!.value);
      const hour = Number(parts.find((p) => p.type === "hour")!.value) % 24;
      if (day !== 1 || hour !== 1) continue;

      // Last month's leaderboard.
      const lastMonthAnchor = new Date(now);
      lastMonthAnchor.setUTCDate(lastMonthAnchor.getUTCDate() - 5);
      const { yearMonth: lastYM } = gymMonthBounds(
        gym.timezone,
        lastMonthAnchor
      );
      const lb = (await step.run(
        `snapshot-${gym.id}-${lastYM}`,
        async () => getMonthlyLeaderboard(gym.id, lastYM, 1000)
      )) as Array<{
        userId: string;
        classesAttended: number;
        rank: number;
        qualified: boolean;
      }>;
      if (!lb.length) continue;

      // Insert snapshot rows (idempotent: existing rows on PK conflict are
      // ignored).
      await step.run(`write-snapshot-${gym.id}-${lastYM}`, async () => {
        await db
          .insert(committedClubSnapshots)
          .values(
            lb.map((r) => ({
              communityId: gym.id,
              yearMonth: lastYM,
              userId: r.userId,
              rank: r.rank,
              classesAttended: r.classesAttended,
            }))
          )
          .onConflictDoNothing();
      });
      snapshotted += lb.length;

      // Streak update: qualified members extend, non-qualified reset.
      for (const r of lb) {
        await step.run(`streak-${gym.id}-${r.userId}`, async () => {
          const [existing] = await db
            .select()
            .from(userStreakCache)
            .where(eq(userStreakCache.userId, r.userId))
            .limit(1);
          const prevStreak = existing?.currentStreak ?? 0;
          const nextStreak = r.qualified ? prevStreak + 1 : 0;
          await db
            .insert(userStreakCache)
            .values({
              userId: r.userId,
              communityId: gym.id,
              currentStreak: nextStreak,
              longestStreak: Math.max(existing?.longestStreak ?? 0, nextStreak),
              lastQualifiedMonth: r.qualified ? lastYM : existing?.lastQualifiedMonth,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [userStreakCache.userId, userStreakCache.communityId],
              set: {
                currentStreak: nextStreak,
                longestStreak: Math.max(existing?.longestStreak ?? 0, nextStreak),
                lastQualifiedMonth: r.qualified
                  ? lastYM
                  : existing?.lastQualifiedMonth,
                updatedAt: new Date(),
              },
            });
          if (r.qualified && nextStreak >= 2) {
            const [n] = await db
              .insert(notifications)
              .values({
                recipientId: r.userId,
                kind: "committed_club_streak",
                communityId: gym.id,
              })
              .returning({ id: notifications.id });
            await inngest.send({
              id: `dispatch:${n.id}`,
              name: "notifications/created",
              data: { notificationId: n.id },
            });
            notified++;
          }
        });
      }
    }
    return { snapshotted, notified };
  }
);
