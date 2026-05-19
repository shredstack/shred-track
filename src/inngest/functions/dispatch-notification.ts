// dispatch-notification (spec §1.10)
//
// Triggered when a notifications row is inserted (the existing
// notify-reaction-created / notify-comment-created functions emit
// `notifications/created` after they write the in-app row). Fans out an
// APNS push to every push_token belonging to the recipient, respecting
// notification_preferences.pushEnabled.
//
// Invalid tokens (BadDeviceToken / Unregistered / ExpiredToken) are
// deleted so we don't keep retrying them.

import { and, eq } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "@/db";
import {
  notifications,
  notificationPreferences,
  pushTokens,
  users,
  workouts,
} from "@/db/schema";
import { sendApnsPush } from "@/lib/push/apns";
import {
  renderNotificationCopy,
  type NotifKind,
} from "@/lib/notifications/copy";

const KNOWN_KINDS: ReadonlySet<NotifKind> = new Set<NotifKind>([
  "score_reaction",
  "score_comment",
  "score_mention",
]);

export const dispatchNotification = inngest.createFunction(
  {
    id: "notifications-dispatch",
    retries: 2,
    triggers: [{ event: "notifications/created" }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: { event: any; step: any }) => {
    const { notificationId } = event.data as { notificationId: string };
    if (!notificationId) return { skipped: "missing-id" };

    const notif = await step.run("load-notification", async () => {
      const [row] = await db
        .select({
          id: notifications.id,
          recipientId: notifications.recipientId,
          actorId: notifications.actorId,
          kind: notifications.kind,
          workoutId: notifications.workoutId,
        })
        .from(notifications)
        .where(eq(notifications.id, notificationId))
        .limit(1);
      return row ?? null;
    });

    if (!notif) return { skipped: "not-found" };
    if (notif.recipientId === notif.actorId) return { skipped: "self" };

    if (!KNOWN_KINDS.has(notif.kind as NotifKind)) {
      // Unknown kind — let it sit in the in-app inbox but skip push.
      return { skipped: "unknown-kind" };
    }
    const kind = notif.kind as NotifKind;

    const pref = await step.run("load-pref", async () => {
      const [row] = await db
        .select({ pushEnabled: notificationPreferences.pushEnabled })
        .from(notificationPreferences)
        .where(
          and(
            eq(notificationPreferences.userId, notif.recipientId),
            eq(notificationPreferences.kind, kind)
          )
        )
        .limit(1);
      return row ?? { pushEnabled: true };
    });
    if (!pref.pushEnabled) return { skipped: "pref-disabled" };

    const tokens = await step.run("load-tokens", async () => {
      return db
        .select({
          id: pushTokens.id,
          token: pushTokens.token,
          platform: pushTokens.platform,
        })
        .from(pushTokens)
        .where(eq(pushTokens.userId, notif.recipientId));
    });
    if (tokens.length === 0) return { skipped: "no-tokens" };

    const ctx = await step.run("load-copy-ctx", async () => {
      const [actor] = notif.actorId
        ? await db
            .select({ name: users.name })
            .from(users)
            .where(eq(users.id, notif.actorId))
            .limit(1)
        : [undefined as { name: string } | undefined];
      const [w] = notif.workoutId
        ? await db
            .select({ title: workouts.title })
            .from(workouts)
            .where(eq(workouts.id, notif.workoutId))
            .limit(1)
        : [undefined as { title: string | null } | undefined];
      return {
        actorName: actor?.name,
        workoutTitle: w?.title ?? undefined,
      };
    });

    const copy = renderNotificationCopy(kind, notif.id, ctx);
    const targetUrl = notif.workoutId
      ? `/crossfit?date=&workout=${notif.workoutId}`
      : undefined;

    type SendResult = { tokenId: string; ok: boolean; invalid: boolean };
    const results = (await step.run("send-pushes", async () => {
      const out: SendResult[] = [];
      for (const t of tokens) {
        if (t.platform !== "ios") {
          // Android: not implemented in v1. Skip silently so when we add
          // FCM later we don't have to backfill rows.
          out.push({ tokenId: t.id, ok: false, invalid: false });
          continue;
        }
        const res = await sendApnsPush(t.token, {
          title: copy.title,
          body: copy.body,
          targetUrl,
          threadId: `kind:${kind}`,
        });
        out.push({
          tokenId: t.id,
          ok: res.ok,
          invalid: res.isInvalidToken,
        });
      }
      return out;
    })) as SendResult[];

    // Prune invalid tokens. Best-effort: a follow-up dispatch will retry if
    // this cleanup fails.
    const invalidIds = results.filter((r) => r.invalid).map((r) => r.tokenId);
    if (invalidIds.length > 0) {
      await step.run("prune-invalid-tokens", async () => {
        for (const id of invalidIds) {
          await db.delete(pushTokens).where(eq(pushTokens.id, id));
        }
      });
    }

    const okCount = results.filter((r) => r.ok).length;
    return { delivered: okCount, total: tokens.length };
  }
);
