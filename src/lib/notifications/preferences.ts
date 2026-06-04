// Notification-preference defaults + batched resolver.
//
// Single source of truth for "which notification kinds default OFF when
// the user has no preference row". Used by:
//   - dispatch-notification.ts          (push delivery)
//   - filterRecipientsByInAppPref(...)  (in-app insert gates)
//   - settings/notifications/page.tsx   (UI default state)
//
// Keeping these in sync matters: if the UI says "off by default" but the
// server still inserts the row, the user opens the inbox and sees the
// notification they thought they'd opted out of.

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { notificationPreferences } from "@/db/schema";
import type { NotifKind } from "./copy";

// Kinds that default OFF when no preference row exists. Users opt in via
// /settings/notifications.
//
//   class_reservation_reminder — explicit opt-in per spec §3.4 (fatigue).
//   gym social board + workout publish — explicit opt-in so a new gym
//     doesn't blast its members on first publish. Users who want them
//     turn them on in Settings → Notifications → Gym Activity.
export const DEFAULT_OFF_KINDS: ReadonlySet<NotifKind> = new Set<NotifKind>([
  "class_reservation_reminder",
  "workout_published",
  "social_post_published",
  "social_post_reaction",
  "social_post_comment",
  "social_post_mention",
]);

/** Default for a given kind when the user has no preference row. */
export function defaultOnFor(kind: NotifKind): boolean {
  return !DEFAULT_OFF_KINDS.has(kind);
}

/**
 * Batched per-recipient in-app filter. Returns the subset of `userIds`
 * for whom `notification_preferences.inAppEnabled` resolves to true
 * (explicit row honoured; missing row falls back to DEFAULT_OFF_KINDS).
 *
 * One query regardless of recipient count. Pair with
 * filterRecipientsByFlag("gym_notifications", ...) at gym-context fan-out
 * sites so a row only lands in the inbox when both gates pass.
 */
export async function filterRecipientsByInAppPref(
  kind: NotifKind,
  userIds: string[]
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({
      userId: notificationPreferences.userId,
      inAppEnabled: notificationPreferences.inAppEnabled,
    })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.kind, kind),
        inArray(notificationPreferences.userId, userIds)
      )
    );
  const explicit = new Map(rows.map((r) => [r.userId, r.inAppEnabled]));
  const fallback = defaultOnFor(kind);
  return userIds.filter((id) => explicit.get(id) ?? fallback);
}

/** Single-recipient convenience for inAppEnabled with the same fallback. */
export async function isInAppEnabled(
  userId: string,
  kind: NotifKind
): Promise<boolean> {
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
  return row?.inAppEnabled ?? defaultOnFor(kind);
}
