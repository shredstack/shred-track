// POST /api/gym/[id]/programming/[releaseId]/publish
//
// Flips a draft release to published. Coach/admin only (spec uses
// canPublishProgramming alias; we delegate to canManageGym for v1).
// Also flips workouts.published=true for every workout tied to the
// release so the member-facing CrossFit GET returns them.
//
// PR 2 §2.4: walks active inline tracks overlapping the week and injects
// per-day workout_sections.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  programmingReleases,
  workouts,
  communityMemberships,
  notifications,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";
import { injectInlineTrackSections } from "@/lib/programming/inline-track-injection";
import { inngest } from "@/inngest/client";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; releaseId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: communityId, releaseId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let weekStart: string | null = null;
  await db.transaction(async (tx) => {
    const [rel] = await tx
      .update(programmingReleases)
      .set({
        status: "published",
        publishedAt: new Date(),
        publishedBy: user.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(programmingReleases.id, releaseId),
          eq(programmingReleases.communityId, communityId)
        )
      )
      .returning({ weekStart: programmingReleases.weekStart });
    weekStart = rel?.weekStart ?? null;

    await tx
      .update(workouts)
      .set({ published: true, updatedAt: new Date() })
      .where(eq(workouts.programmingReleaseId, releaseId));
  });

  // Inline track injection happens outside the transaction (it has its own
  // small transactions internally). Idempotent on retry.
  let injected = 0;
  if (weekStart) {
    const r = await injectInlineTrackSections({ communityId, weekStart });
    injected = r.inserted;
  }

  // Fire workout_published notifications for each day. Per spec §2.6,
  // dispatch is per-day at 6am gym-local via Inngest delay. We insert the
  // in-app notification rows now (so the inbox shows them) and the
  // dispatcher fans out push when each delivery fires; the dispatcher
  // itself respects pushEnabled per kind. For v1 we send all events
  // immediately and let the dispatcher pick from preferences.
  const published = await db
    .select({ id: workouts.id })
    .from(workouts)
    .where(eq(workouts.programmingReleaseId, releaseId));
  const members = await db
    .select({ userId: communityMemberships.userId })
    .from(communityMemberships)
    .where(
      and(
        eq(communityMemberships.communityId, communityId),
        eq(communityMemberships.isActive, true)
      )
    );
  if (published.length && members.length) {
    // One notification per (member × workout-day). Heavy with many days,
    // but a week × 100 members = 700 rows — fine.
    const recipients = members
      .map((m) => m.userId)
      .filter((id) => id !== user.id);
    if (recipients.length) {
      const rows: Array<{
        recipientId: string;
        actorId: string;
        kind: "workout_published";
        communityId: string;
        workoutId: string;
      }> = [];
      for (const w of published) {
        for (const rid of recipients) {
          rows.push({
            recipientId: rid,
            actorId: user.id,
            kind: "workout_published",
            communityId,
            workoutId: w.id,
          });
        }
      }
      if (rows.length) {
        const inserted = await db
          .insert(notifications)
          .values(rows)
          .returning({ id: notifications.id });
        for (const n of inserted) {
          try {
            await inngest.send({
              id: `dispatch:${n.id}`,
              name: "notifications/created",
              data: { notificationId: n.id },
            });
          } catch (err) {
            console.error("[publish] dispatch failed", err);
          }
        }
      }
    }
  }

  return NextResponse.json({ ok: true, injectedSections: injected });
}
