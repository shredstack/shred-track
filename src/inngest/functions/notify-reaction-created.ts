import { and, eq } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "@/db";
import {
  scores,
  workouts,
  notifications,
  notificationPreferences,
} from "@/db/schema";

// social/reaction.created
//
// Fan-out: insert a single in-app notification for the score owner, unless
// the actor reacted to their own score (skip silently) or the owner has
// disabled in-app notifications for this kind.

export const notifyReactionCreated = inngest.createFunction(
  {
    id: "social-notify-reaction-created",
    retries: 2,
    triggers: [{ event: "social/reaction.created" }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: { event: any; step: any }) => {
    const { reactionId, scoreId, actorId } = event.data as {
      reactionId: string;
      scoreId: string;
      actorId: string;
    };

    const ctx = await step.run("load-score-context", async () => {
      const [row] = await db
        .select({
          ownerId: scores.userId,
          workoutId: scores.workoutId,
          workoutPartId: scores.workoutPartId,
          communityId: workouts.communityId,
        })
        .from(scores)
        .innerJoin(workouts, eq(workouts.id, scores.workoutId))
        .where(eq(scores.id, scoreId))
        .limit(1);
      return row ?? null;
    });

    if (!ctx) return { skipped: "score-not-found" };
    if (ctx.ownerId === actorId) return { skipped: "self-reaction" };

    const pref = await step.run("load-pref", async () => {
      const [row] = await db
        .select({ inAppEnabled: notificationPreferences.inAppEnabled })
        .from(notificationPreferences)
        .where(
          and(
            eq(notificationPreferences.userId, ctx.ownerId),
            eq(notificationPreferences.kind, "score_reaction")
          )
        )
        .limit(1);
      // Missing row = defaults on.
      return row ?? { inAppEnabled: true };
    });

    if (!pref.inAppEnabled) return { skipped: "pref-disabled" };

    const inserted = await step.run("insert-notification", async () => {
      const [row] = await db
        .insert(notifications)
        .values({
          recipientId: ctx.ownerId,
          actorId,
          kind: "score_reaction",
          scoreId,
          reactionId,
          workoutId: ctx.workoutId,
          workoutPartId: ctx.workoutPartId,
          communityId: ctx.communityId,
        })
        .returning({ id: notifications.id });
      return row;
    });

    // Fan out push delivery via the dispatcher.
    await step.sendEvent("dispatch-push", {
      name: "notifications/created",
      data: { notificationId: inserted.id },
    });

    return { delivered: true, notificationId: inserted.id };
  }
);
