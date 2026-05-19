import { and, eq, inArray } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "@/db";
import {
  scores,
  workouts,
  scoreComments,
  notifications,
  notificationPreferences,
} from "@/db/schema";

// Helper — kind-keyed in_app_enabled lookup. Returns true (default-on) when
// no preference row exists for the recipient.
async function isInAppEnabled(userId: string, kind: string): Promise<boolean> {
  const [row] = await db
    .select({ inAppEnabled: notificationPreferences.inAppEnabled })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.kind, kind)
      )
    )
    .limit(1);
  return row?.inAppEnabled ?? true;
}

// social/comment.created
//
// Fan-out: up to N+1 notifications per comment — one to the score owner
// (`score_comment`) and one per mentioned user (`score_mention`). Dedup:
// if the score owner is also mentioned, they get `score_mention` only.
// If the actor is the score owner, the `score_comment` row is skipped
// but mentions still fire. Self-mentions are skipped.

export const notifyCommentCreated = inngest.createFunction(
  {
    id: "social-notify-comment-created",
    retries: 2,
    triggers: [{ event: "social/comment.created" }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: { event: any; step: any }) => {
    const { commentId, scoreId, actorId, mentionedUserIds } = event.data as {
      commentId: string;
      scoreId: string;
      actorId: string;
      mentionedUserIds: string[];
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

    // Verify the comment still exists (and isn't soft-deleted).
    const exists = await step.run("verify-comment", async () => {
      const [row] = await db
        .select({ id: scoreComments.id })
        .from(scoreComments)
        .where(eq(scoreComments.id, commentId))
        .limit(1);
      return !!row;
    });
    if (!exists) return { skipped: "comment-gone" };

    const mentionSet = new Set(
      mentionedUserIds
        .map((id) => id.toLowerCase())
        .filter((id) => id !== actorId.toLowerCase())
    );
    // Owner gets score_mention (more specific) if also mentioned.
    const ownerMentioned = mentionSet.has(ctx.ownerId.toLowerCase());
    if (ownerMentioned) mentionSet.delete(ctx.ownerId.toLowerCase());

    const inserts: Array<{
      recipientId: string;
      kind: "score_comment" | "score_mention";
    }> = [];

    // score_comment for the owner — unless owner is actor or owner was
    // mentioned (more specific) or pref disabled.
    if (!ownerMentioned && ctx.ownerId !== actorId) {
      const enabled = await step.run("owner-pref", () =>
        isInAppEnabled(ctx.ownerId, "score_comment")
      );
      if (enabled) {
        inserts.push({ recipientId: ctx.ownerId, kind: "score_comment" });
      }
    }

    // score_mention for the owner if mentioned, then for each other mentionee.
    const mentionRecipients: string[] = [];
    if (ownerMentioned && ctx.ownerId !== actorId) {
      mentionRecipients.push(ctx.ownerId);
    }
    mentionRecipients.push(...mentionSet);

    if (mentionRecipients.length > 0) {
      const enabledMap = await step.run("mention-prefs", async () => {
        const rows = await db
          .select({
            userId: notificationPreferences.userId,
            inAppEnabled: notificationPreferences.inAppEnabled,
          })
          .from(notificationPreferences)
          .where(
            and(
              eq(notificationPreferences.kind, "score_mention"),
              inArray(notificationPreferences.userId, mentionRecipients)
            )
          );
        const map = new Map(rows.map((r) => [r.userId, r.inAppEnabled]));
        // Missing rows default to enabled.
        return Object.fromEntries(
          mentionRecipients.map((id) => [id, map.get(id) ?? true])
        );
      });
      for (const id of mentionRecipients) {
        if (enabledMap[id]) {
          inserts.push({ recipientId: id, kind: "score_mention" });
        }
      }
    }

    if (inserts.length === 0) return { delivered: 0 };

    const insertedIds = await step.run("insert-notifications", async () => {
      const rows = await db
        .insert(notifications)
        .values(
          inserts.map((i) => ({
            recipientId: i.recipientId,
            actorId,
            kind: i.kind,
            scoreId,
            commentId,
            workoutId: ctx.workoutId,
            workoutPartId: ctx.workoutPartId,
            communityId: ctx.communityId,
          }))
        )
        .returning({ id: notifications.id });
      return rows.map((r) => r.id);
    });

    for (const id of insertedIds) {
      await step.sendEvent("dispatch-push", {
        name: "notifications/created",
        data: { notificationId: id },
      });
    }

    return { delivered: inserts.length };
  }
);

// social/comment.mentioned — fires on edit when new mention ids appear.
// Same notification rules as score_mention above, scoped to the new ids.
export const notifyCommentMentioned = inngest.createFunction(
  {
    id: "social-notify-comment-mentioned",
    retries: 2,
    triggers: [{ event: "social/comment.mentioned" }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: { event: any; step: any }) => {
    const { commentId, scoreId, actorId, mentionedUserIds } = event.data as {
      commentId: string;
      scoreId: string;
      actorId: string;
      mentionedUserIds: string[];
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

    const recipients = mentionedUserIds
      .map((id) => id.toLowerCase())
      .filter((id) => id !== actorId.toLowerCase());
    if (recipients.length === 0) return { delivered: 0 };

    const enabledMap = await step.run("mention-prefs", async () => {
      const rows = await db
        .select({
          userId: notificationPreferences.userId,
          inAppEnabled: notificationPreferences.inAppEnabled,
        })
        .from(notificationPreferences)
        .where(
          and(
            eq(notificationPreferences.kind, "score_mention"),
            inArray(notificationPreferences.userId, recipients)
          )
        );
      const map = new Map(rows.map((r) => [r.userId, r.inAppEnabled]));
      return Object.fromEntries(
        recipients.map((id) => [id, map.get(id) ?? true])
      );
    });

    const inserts = recipients.filter((id) => enabledMap[id]);
    if (inserts.length === 0) return { delivered: 0 };

    const insertedIds = await step.run("insert-notifications", async () => {
      const rows = await db
        .insert(notifications)
        .values(
          inserts.map((id) => ({
            recipientId: id,
            actorId,
            kind: "score_mention" as const,
            scoreId,
            commentId,
            workoutId: ctx.workoutId,
            workoutPartId: ctx.workoutPartId,
            communityId: ctx.communityId,
          }))
        )
        .returning({ id: notifications.id });
      return rows.map((r) => r.id);
    });

    for (const id of insertedIds) {
      await step.sendEvent("dispatch-push", {
        name: "notifications/created",
        data: { notificationId: id },
      });
    }

    return { delivered: inserts.length };
  }
);
