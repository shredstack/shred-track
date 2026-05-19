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
  programmingReleases,
  pushTokens,
  users,
  workouts,
  communities,
  gymPosts,
  classInstances,
  classSchedules,
} from "@/db/schema";
import { sendApnsPush } from "@/lib/push/apns";
import {
  renderNotificationCopy,
  type NotifKind,
  type CopyContext,
} from "@/lib/notifications/copy";

const KNOWN_KINDS: ReadonlySet<NotifKind> = new Set<NotifKind>([
  "score_reaction",
  "score_comment",
  "score_mention",
  "workout_published",
  "social_post_published",
  "social_post_reaction",
  "social_post_comment",
  "social_post_mention",
  "committed_club_progress",
  "committed_club_earned",
  "committed_club_streak",
  "class_cancelled",
  "class_reservation_reminder",
]);

// Kinds that default OFF when no preference row exists for the user.
// Class reservation reminders are explicit opt-in per spec §3.4 to
// avoid notification fatigue.
const DEFAULT_OFF_KINDS: ReadonlySet<NotifKind> = new Set<NotifKind>([
  "class_reservation_reminder",
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

    const notif = (await step.run("load-notification", async () => {
      const [row] = await db
        .select({
          id: notifications.id,
          recipientId: notifications.recipientId,
          actorId: notifications.actorId,
          kind: notifications.kind,
          workoutId: notifications.workoutId,
          programmingReleaseId: notifications.programmingReleaseId,
          gymPostId: notifications.gymPostId,
          classInstanceId: notifications.classInstanceId,
          communityId: notifications.communityId,
        })
        .from(notifications)
        .where(eq(notifications.id, notificationId))
        .limit(1);
      return row ?? null;
    })) as {
      id: string;
      recipientId: string;
      actorId: string | null;
      kind: string;
      workoutId: string | null;
      programmingReleaseId: string | null;
      gymPostId: string | null;
      classInstanceId: string | null;
      communityId: string | null;
    } | null;

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
      if (row) return row;
      return { pushEnabled: !DEFAULT_OFF_KINDS.has(kind) };
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

    const ctx = (await step.run("load-copy-ctx", async () => {
      const out: CopyContext = {};
      if (notif.actorId) {
        const [actor] = await db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, notif.actorId))
          .limit(1);
        out.actorName = actor?.name;
      }
      if (notif.workoutId) {
        const [w] = await db
          .select({ title: workouts.title })
          .from(workouts)
          .where(eq(workouts.id, notif.workoutId))
          .limit(1);
        out.workoutTitle = w?.title ?? undefined;
      }
      if (notif.programmingReleaseId) {
        const [r] = await db
          .select({ weekStart: programmingReleases.weekStart })
          .from(programmingReleases)
          .where(eq(programmingReleases.id, notif.programmingReleaseId))
          .limit(1);
        out.releaseWeekStart = r?.weekStart ?? undefined;
      }
      if (notif.communityId) {
        const [c] = await db
          .select({ name: communities.name })
          .from(communities)
          .where(eq(communities.id, notif.communityId))
          .limit(1);
        out.gymName = c?.name;
      }
      if (notif.gymPostId) {
        const [p] = await db
          .select({ body: gymPosts.body })
          .from(gymPosts)
          .where(eq(gymPosts.id, notif.gymPostId))
          .limit(1);
        if (p?.body) out.excerpt = p.body;
      }
      if (notif.classInstanceId) {
        const [ci] = await db
          .select({
            scheduleId: classInstances.scheduleId,
            startAt: classInstances.startAt,
            eventTitle: classInstances.eventTitle,
          })
          .from(classInstances)
          .where(eq(classInstances.id, notif.classInstanceId))
          .limit(1);
        if (ci) {
          out.classStartAt = ci.startAt.toISOString();
          if (ci.eventTitle) {
            out.className = ci.eventTitle;
          } else if (ci.scheduleId) {
            const [s] = await db
              .select({ name: classSchedules.name })
              .from(classSchedules)
              .where(eq(classSchedules.id, ci.scheduleId))
              .limit(1);
            out.className = s?.name;
          }
        }
      }
      return out;
    })) as CopyContext;

    const copy = renderNotificationCopy(kind, notif.id, ctx);
    // Mirror the in-app routing in src/app/(app)/notifications/page.tsx so
    // a push tap lands in the same place as an inbox tap. Gym-scoped
    // destinations carry ?community=<id> so the deep-link handler can flip
    // the active gym before navigating.
    const communityParam = notif.communityId
      ? `?community=${notif.communityId}`
      : "";
    const targetUrl = notif.gymPostId
      ? `/gym/social/${notif.gymPostId}${communityParam}`
      : notif.classInstanceId
        ? `/classes${communityParam}`
        : notif.communityId && kind.startsWith("committed_club")
          ? `/gym/committed-club${communityParam}`
          : kind === "workout_published"
            ? `/crossfit${communityParam}`
            : notif.workoutId
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
