// class-reservation-reminder (spec §3.4)
//
// 5-minute cron. Finds class_registrations with status='registered' for
// classes starting in roughly 60 minutes from now and dispatches a
// `class_reservation_reminder` notification to each registered member.
// The dispatcher honors notification_preferences (kind defaults OFF per
// spec — explicit opt-in to avoid notification fatigue).
//
// Dedup: we only fire a reminder for a (registration, instance) pair
// once. A `reminder_sent_at` column on class_registrations isn't part
// of the schema, so we rely on the existing notifications table to
// dedup via a uniqueness check by (recipient, kind, classInstanceId).

import { and, eq, gte, lt } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "@/db";
import {
  classInstances,
  classRegistrations,
  notifications,
} from "@/db/schema";

const CRON = "*/5 * * * *"; // every 5 minutes

export const classReservationReminder = inngest.createFunction(
  {
    id: "classes-reservation-reminder",
    retries: 1,
    triggers: [{ cron: CRON }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ step }: { step: any }) => {
    const now = new Date();
    // 60-minute lookahead window: classes starting in [55min, 65min] from
    // now (10-minute spread to absorb the 5-minute cron cadence + clock
    // skew without double-firing).
    const lookaheadStart = new Date(now.getTime() + 55 * 60_000);
    const lookaheadEnd = new Date(now.getTime() + 65 * 60_000);

    const candidates = (await step.run("list-candidates", async () => {
      return db
        .select({
          registrationId: classRegistrations.id,
          userId: classRegistrations.userId,
          classInstanceId: classInstances.id,
          communityId: classInstances.communityId,
          startAt: classInstances.startAt,
        })
        .from(classRegistrations)
        .innerJoin(
          classInstances,
          eq(classInstances.id, classRegistrations.classInstanceId)
        )
        .where(
          and(
            eq(classRegistrations.status, "registered"),
            eq(classInstances.status, "scheduled"),
            gte(classInstances.startAt, lookaheadStart),
            lt(classInstances.startAt, lookaheadEnd)
          )
        );
    })) as Array<{
      registrationId: string;
      userId: string;
      classInstanceId: string;
      communityId: string;
      startAt: Date;
    }>;

    if (candidates.length === 0) {
      return { fired: 0 };
    }

    let fired = 0;
    for (const c of candidates) {
      // Skip if we already sent a reminder for this (user, class).
      const existing = (await step.run(`dedup:${c.registrationId}`, async () => {
        const [row] = await db
          .select({ id: notifications.id })
          .from(notifications)
          .where(
            and(
              eq(notifications.recipientId, c.userId),
              eq(notifications.kind, "class_reservation_reminder"),
              eq(notifications.classInstanceId, c.classInstanceId)
            )
          )
          .limit(1);
        return row ?? null;
      })) as { id: string } | null;
      if (existing) continue;

      const [inserted] = (await step.run(
        `insert:${c.registrationId}`,
        async () => {
          return db
            .insert(notifications)
            .values({
              recipientId: c.userId,
              // No specific actor — system-generated.
              actorId: null,
              kind: "class_reservation_reminder",
              communityId: c.communityId,
              classInstanceId: c.classInstanceId,
            })
            .returning({ id: notifications.id });
        }
      )) as Array<{ id: string }>;

      if (inserted?.id) {
        try {
          await step.sendEvent(`dispatch:${inserted.id}`, {
            name: "notifications/created",
            data: { notificationId: inserted.id },
          });
          fired += 1;
        } catch (err) {
          console.error("[class-reservation-reminder] dispatch failed", err);
        }
      }
    }

    return { fired };
  }
);
