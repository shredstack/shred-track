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
import { and, eq, sql } from "drizzle-orm";
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

  // Fire one workout_published notification per (release × member). The
  // inbox row renders "Programming dropped — week of <Monday>" from the
  // release; tapping drops the athlete on today's CrossFit tab so they
  // can navigate the week themselves. The dispatcher fans push out and
  // respects pushEnabled per kind. A partial unique index on
  // (recipient_id, programming_release_id) WHERE kind='workout_published'
  // makes republish / retry idempotent via ON CONFLICT DO NOTHING.
  const members = await db
    .select({ userId: communityMemberships.userId })
    .from(communityMemberships)
    .where(
      and(
        eq(communityMemberships.communityId, communityId),
        eq(communityMemberships.isActive, true)
      )
    );
  const recipients = members
    .map((m) => m.userId)
    .filter((id) => id !== user.id);
  if (recipients.length) {
    const rows = recipients.map((rid) => ({
      recipientId: rid,
      actorId: user.id,
      kind: "workout_published" as const,
      communityId,
      programmingReleaseId: releaseId,
    }));
    // Match the partial unique index from
    // 20260519204534_add_programming_release_id_to_notifications.sql —
    // Postgres needs the index predicate after the conflict target.
    const inserted = await db
      .insert(notifications)
      .values(rows)
      .onConflictDoNothing({
        target: [notifications.recipientId, notifications.programmingReleaseId],
        where: sql`kind = 'workout_published' AND programming_release_id IS NOT NULL`,
      })
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

  return NextResponse.json({ ok: true, injectedSections: injected });
}
