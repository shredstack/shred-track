// GET    /api/gym-posts/[id] — single-post detail (used by the post detail
//                              page after a notification tap).
// PATCH  /api/gym-posts/[id] — update an existing gym post. Used by the
//                              coach review queue to approve
//                              (status='pending_review' → 'published') or
//                              edit-and-approve (body + status)
//                              anniversary/birthday auto-posts.
// DELETE /api/gym-posts/[id] — soft-delete (status='deleted'). Author or
//                              gym manager only.

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  gymPostAttachments,
  gymPostComments,
  gymPostReactions,
  gymPosts,
  notifications,
  communityMemberships,
  users,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym, canViewGym } from "@/lib/authz/community";
import { inngest } from "@/inngest/client";
import { and, sql } from "drizzle-orm";
import { filterRecipientsByFlag } from "@/lib/feature-flags";
import { filterRecipientsByInAppPref } from "@/lib/notifications/preferences";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [row] = await db
    .select({
      id: gymPosts.id,
      kind: gymPosts.kind,
      status: gymPosts.status,
      body: gymPosts.body,
      workoutId: gymPosts.workoutId,
      workoutDate: gymPosts.workoutDate,
      isPinned: gymPosts.isPinned,
      publishedAt: gymPosts.publishedAt,
      communityId: gymPosts.communityId,
      authorId: gymPosts.authorId,
      authorName: users.name,
      authorImage: users.image,
    })
    .from(gymPosts)
    .innerJoin(users, eq(users.id, gymPosts.authorId))
    .where(eq(gymPosts.id, id))
    .limit(1);

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canViewGym(user.id, row.communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Hide non-published posts from non-managers (drafts, pending review,
  // deleted). Managers and the author can still see them.
  if (row.status !== "published") {
    const isManager = await canManageGym(user.id, row.communityId);
    if (!isManager && row.authorId !== user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  const [attachments, reactionCountRow, commentCountRow, myReactionRow] =
    await Promise.all([
      db
        .select()
        .from(gymPostAttachments)
        .where(eq(gymPostAttachments.postId, id)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(gymPostReactions)
        .where(eq(gymPostReactions.postId, id)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(gymPostComments)
        .where(
          and(
            eq(gymPostComments.postId, id),
            sql`${gymPostComments.deletedAt} is null`
          )
        ),
      db
        .select({ id: gymPostReactions.id })
        .from(gymPostReactions)
        .where(
          and(
            eq(gymPostReactions.postId, id),
            eq(gymPostReactions.userId, user.id)
          )
        )
        .limit(1),
    ]);
  return NextResponse.json({
    id: row.id,
    kind: row.kind,
    body: row.body,
    workoutId: row.workoutId,
    workoutDate: row.workoutDate,
    isPinned: row.isPinned,
    publishedAt: row.publishedAt?.toISOString() ?? new Date(0).toISOString(),
    communityId: row.communityId,
    author: {
      id: row.authorId,
      name: row.authorName,
      image: row.authorImage,
    },
    attachments: attachments.sort((a, b) => a.position - b.position),
    reactionCount: reactionCountRow[0]?.count ?? 0,
    commentCount: commentCountRow[0]?.count ?? 0,
    viewerReacted: myReactionRow.length > 0,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const [post] = await db
    .select()
    .from(gymPosts)
    .where(eq(gymPosts.id, id))
    .limit(1);
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const isManager = await canManageGym(user.id, post.communityId);
  if (post.authorId !== user.id && !isManager) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const updates: Partial<typeof gymPosts.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (typeof body.body === "string") updates.body = body.body;
  const wasPendingReview = post.status === "pending_review";
  if (typeof body.status === "string") {
    if (!isManager && body.status !== "deleted") {
      return NextResponse.json(
        { error: "Only managers can change status" },
        { status: 403 }
      );
    }
    updates.status = body.status;
    if (body.status === "published" && !post.publishedAt) {
      updates.publishedAt = new Date();
    }
  }
  if (typeof body.isPinned === "boolean" && isManager) {
    updates.isPinned = body.isPinned;
  }
  await db.update(gymPosts).set(updates).where(eq(gymPosts.id, id));

  // When approving a pending_review post, fan out social_post_published.
  // Recipient list is filtered by `gym_notifications` per recipient.
  if (
    wasPendingReview &&
    updates.status === "published" &&
    isManager
  ) {
    const members = await db
      .select({ userId: communityMemberships.userId })
      .from(communityMemberships)
      .where(
        and(
          eq(communityMemberships.communityId, post.communityId),
          eq(communityMemberships.isActive, true)
        )
      );
    const candidates = members
      .map((m) => m.userId)
      .filter((id) => id !== post.authorId);
    const flagPassed = await filterRecipientsByFlag(
      "gym_notifications",
      post.communityId,
      candidates
    );
    const recipients = await filterRecipientsByInAppPref(
      "social_post_published",
      flagPassed
    );
    if (recipients.length) {
      const inserted = await db
        .insert(notifications)
        .values(
          recipients.map((rid) => ({
            recipientId: rid,
            actorId: post.authorId,
            kind: "social_post_published" as const,
            communityId: post.communityId,
            gymPostId: id,
          }))
        )
        .returning({ id: notifications.id });
      for (const n of inserted) {
        try {
          await inngest.send({
            id: `dispatch:${n.id}`,
            name: "notifications/created",
            data: { notificationId: n.id },
          });
        } catch (err) {
          console.error("[gym-posts] approve dispatch failed", err);
        }
      }
    }
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const [post] = await db
    .select({ authorId: gymPosts.authorId, communityId: gymPosts.communityId })
    .from(gymPosts)
    .where(eq(gymPosts.id, id))
    .limit(1);
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const isManager = await canManageGym(user.id, post.communityId);
  if (post.authorId !== user.id && !isManager) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await db
    .update(gymPosts)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(eq(gymPosts.id, id));
  return new NextResponse(null, { status: 204 });
}
