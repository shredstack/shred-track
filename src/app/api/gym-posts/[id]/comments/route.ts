// POST/GET /api/gym-posts/[id]/comments
//
// GET: list non-deleted comments for a post (active gym members).
// POST: create a comment. Body shape: { body, mentionedUserIds? }.
// Fires social_post_comment to the post author and social_post_mention
// for each mentioned gym member.

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  gymPosts,
  gymPostComments,
  notifications,
  users,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canViewGym } from "@/lib/authz/community";
import { inngest } from "@/inngest/client";
import { parseMentionsFromBody } from "@/lib/social/mentions";
import { sql } from "drizzle-orm";
import { isFlagOn, filterRecipientsByFlag } from "@/lib/feature-flags";
import {
  isInAppEnabled,
  filterRecipientsByInAppPref,
} from "@/lib/notifications/preferences";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: postId } = await params;
  const [post] = await db
    .select({ communityId: gymPosts.communityId })
    .from(gymPosts)
    .where(eq(gymPosts.id, postId))
    .limit(1);
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canViewGym(user.id, post.communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const rows = await db
    .select({
      id: gymPostComments.id,
      body: gymPostComments.body,
      mentionedUserIds: gymPostComments.mentionedUserIds,
      createdAt: gymPostComments.createdAt,
      userId: gymPostComments.userId,
      userName: users.name,
      userImage: users.image,
    })
    .from(gymPostComments)
    .innerJoin(users, eq(users.id, gymPostComments.userId))
    .where(
      and(
        eq(gymPostComments.postId, postId),
        sql`${gymPostComments.deletedAt} is null`
      )
    )
    .orderBy(asc(gymPostComments.createdAt));
  return NextResponse.json({
    comments: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: postId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.body !== "string" || !body.body.trim()) {
    return NextResponse.json({ error: "Body required" }, { status: 400 });
  }
  const [post] = await db
    .select({
      communityId: gymPosts.communityId,
      authorId: gymPosts.authorId,
    })
    .from(gymPosts)
    .where(eq(gymPosts.id, postId))
    .limit(1);
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canViewGym(user.id, post.communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const mentions = parseMentionsFromBody(body.body);
  const [comment] = await db
    .insert(gymPostComments)
    .values({
      postId,
      userId: user.id,
      body: body.body,
      mentionedUserIds: mentions,
    })
    .returning();

  // Notification fan-out (social_post_comment + social_post_mention) is
  // gated by `gym_notifications` per recipient. The comment itself still
  // lands on the post; we just don't notify if the recipient's resolved
  // flag is off.

  // Comment notification to post author. Skipped if (a) author is the
  // commenter, (b) gym flag is off for them, or (c) they haven't opted
  // in to social_post_comment in /settings/notifications (default off).
  if (
    post.authorId !== user.id &&
    (await isFlagOn("gym_notifications", {
      userId: post.authorId,
      communityId: post.communityId,
    })) &&
    (await isInAppEnabled(post.authorId, "social_post_comment"))
  ) {
    const [n] = await db
      .insert(notifications)
      .values({
        recipientId: post.authorId,
        actorId: user.id,
        kind: "social_post_comment",
        gymPostId: postId,
        gymPostCommentId: comment.id,
        communityId: post.communityId,
      })
      .returning({ id: notifications.id });
    try {
      await inngest.send({
        id: `dispatch:${n.id}`,
        name: "notifications/created",
        data: { notificationId: n.id },
      });
    } catch (err) {
      console.error("[gym-post-comments] dispatch failed", err);
    }
  }
  // Mention notifications.
  if (mentions.length) {
    const candidates = mentions
      .filter((id) => id !== user.id && id !== post.authorId);
    const flagPassed = await filterRecipientsByFlag(
      "gym_notifications",
      post.communityId,
      candidates
    );
    const recipients = await filterRecipientsByInAppPref(
      "social_post_mention",
      flagPassed
    );
    if (recipients.length) {
      const inserted = await db
        .insert(notifications)
        .values(
          recipients.map((id) => ({
            recipientId: id,
            actorId: user.id,
            kind: "social_post_mention" as const,
            gymPostId: postId,
            gymPostCommentId: comment.id,
            communityId: post.communityId,
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
          console.error("[gym-post-comments] mention dispatch failed", err);
        }
      }
    }
  }
  return NextResponse.json({ id: comment.id }, { status: 201 });
}
