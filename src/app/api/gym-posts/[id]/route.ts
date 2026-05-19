// PATCH /api/gym-posts/[id]
//
// Update an existing gym post. Used by the coach review queue to approve
// (status='pending_review' → 'published') or edit-and-approve
// (body + status) anniversary/birthday auto-posts.
// DELETE soft-deletes (status='deleted'). Author or gym manager only.

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { gymPosts, notifications, communityMemberships } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";
import { inngest } from "@/inngest/client";
import { and } from "drizzle-orm";

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
    const recipients = members
      .map((m) => m.userId)
      .filter((id) => id !== post.authorId);
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
