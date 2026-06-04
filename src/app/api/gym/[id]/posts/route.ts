// /api/gym/[id]/posts
//
// GET: published feed for the gym (newest first). Members only.
// POST: create a new post (announcement, whiteboard, meme). Coach+
//   moderation lives here; auto-anniversary posts route through Inngest
//   and bypass this endpoint.

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
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
import { sql } from "drizzle-orm";
import { parseMentionsFromBody } from "@/lib/social/mentions";
import { filterRecipientsByFlag } from "@/lib/feature-flags";
import { filterRecipientsByInAppPref } from "@/lib/notifications/preferences";

const VALID_KINDS = new Set([
  "announcement",
  "whiteboard",
  "meme",
  "pinned",
]);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId } = await params;
  if (!(await canViewGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const since = url.searchParams.get("since");
  const limit = Math.min(50, Number(url.searchParams.get("limit") ?? 20));

  const posts = await db
    .select({
      id: gymPosts.id,
      kind: gymPosts.kind,
      status: gymPosts.status,
      body: gymPosts.body,
      workoutId: gymPosts.workoutId,
      workoutDate: gymPosts.workoutDate,
      isPinned: gymPosts.isPinned,
      publishedAt: gymPosts.publishedAt,
      authorId: gymPosts.authorId,
      authorName: users.name,
      authorImage: users.image,
    })
    .from(gymPosts)
    .innerJoin(users, eq(users.id, gymPosts.authorId))
    .where(
      and(
        eq(gymPosts.communityId, communityId),
        eq(gymPosts.status, "published"),
        since
          ? gte(gymPosts.publishedAt, new Date(since))
          : sql`true`
      )
    )
    .orderBy(desc(gymPosts.isPinned), desc(gymPosts.publishedAt))
    .limit(limit);

  const ids = posts.map((p) => p.id);
  const [attachments, reactions, commentCounts, myReactions] = await Promise.all([
    ids.length
      ? db
          .select()
          .from(gymPostAttachments)
          .where(inArray(gymPostAttachments.postId, ids))
      : Promise.resolve([] as Array<{
          id: string;
          postId: string;
          kind: string;
          url: string;
          thumbnailUrl: string | null;
          width: number | null;
          height: number | null;
          position: number;
        }>),
    ids.length
      ? db
          .select({
            postId: gymPostReactions.postId,
            count: sql<number>`count(*)::int`,
          })
          .from(gymPostReactions)
          .where(inArray(gymPostReactions.postId, ids))
          .groupBy(gymPostReactions.postId)
      : Promise.resolve([] as Array<{ postId: string; count: number }>),
    ids.length
      ? db
          .select({
            postId: gymPostComments.postId,
            count: sql<number>`count(*)::int`,
          })
          .from(gymPostComments)
          .where(
            and(
              inArray(gymPostComments.postId, ids),
              sql`${gymPostComments.deletedAt} is null`
            )
          )
          .groupBy(gymPostComments.postId)
      : Promise.resolve([] as Array<{ postId: string; count: number }>),
    ids.length
      ? db
          .select({ postId: gymPostReactions.postId })
          .from(gymPostReactions)
          .where(
            and(
              inArray(gymPostReactions.postId, ids),
              eq(gymPostReactions.userId, user.id)
            )
          )
      : Promise.resolve([] as Array<{ postId: string }>),
  ]);

  const attachmentsByPost = new Map<string, typeof attachments>();
  for (const a of attachments) {
    const list = attachmentsByPost.get(a.postId) ?? [];
    list.push(a);
    attachmentsByPost.set(a.postId, list);
  }
  const reactionCount = new Map(reactions.map((r) => [r.postId, r.count]));
  const commentCount = new Map(commentCounts.map((c) => [c.postId, c.count]));
  const myReactedSet = new Set(myReactions.map((r) => r.postId));

  return NextResponse.json({
    posts: posts.map((p) => ({
      id: p.id,
      kind: p.kind,
      body: p.body,
      workoutId: p.workoutId,
      workoutDate: p.workoutDate,
      isPinned: p.isPinned,
      publishedAt: p.publishedAt.toISOString(),
      author: {
        id: p.authorId,
        name: p.authorName,
        image: p.authorImage,
      },
      attachments: (attachmentsByPost.get(p.id) ?? []).sort(
        (a, b) => a.position - b.position
      ),
      reactionCount: reactionCount.get(p.id) ?? 0,
      commentCount: commentCount.get(p.id) ?? 0,
      viewerReacted: myReactedSet.has(p.id),
    })),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId } = await params;
  // For pinned posts, require manager; for everything else, viewer is enough
  // (members can post announcements on community boards).
  const body = await req.json().catch(() => null);
  if (!body || !VALID_KINDS.has(body.kind)) {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  }
  const isManagerKind = body.kind === "pinned" || body.kind === "whiteboard";
  const allowed = isManagerKind
    ? await canManageGym(user.id, communityId)
    : await canViewGym(user.id, communityId);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const mentions = body.body ? parseMentionsFromBody(body.body) : [];

  const post = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(gymPosts)
      .values({
        communityId,
        authorId: user.id,
        kind: body.kind,
        status: "published",
        body: typeof body.body === "string" ? body.body : null,
        workoutId: body.workoutId ?? null,
        workoutDate: body.workoutDate ?? null,
        mentionedUserIds: mentions,
        isPinned: body.kind === "pinned",
      })
      .returning();
    if (Array.isArray(body.attachments) && body.attachments.length) {
      await tx.insert(gymPostAttachments).values(
        body.attachments.map(
          (a: {
            kind: string;
            url: string;
            thumbnailUrl?: string | null;
            width?: number | null;
            height?: number | null;
            position?: number;
          }, i: number) => ({
            postId: row.id,
            kind: a.kind,
            url: a.url,
            thumbnailUrl: a.thumbnailUrl ?? null,
            width: a.width ?? null,
            height: a.height ?? null,
            position: a.position ?? i,
          })
        )
      );
    }
    return row;
  });

  // Notification fan-out (social_post_published + social_post_mention) is
  // double-gated: gym-level `gym_notifications` flag (default on, gym
  // kill switch) → per-user `inAppEnabled` for the kind (default OFF, user
  // opt-in via /settings/notifications). The post itself still lands in
  // the feed regardless; we just don't blast inboxes.

  // Fan out social_post_published to active gym members (minus author).
  const members = await db
    .select({ userId: communityMemberships.userId })
    .from(communityMemberships)
    .where(
      and(
        eq(communityMemberships.communityId, communityId),
        eq(communityMemberships.isActive, true)
      )
    );
  const publishCandidates = members
    .map((m) => m.userId)
    .filter((id) => id !== user.id);
  const publishFlagPassed = await filterRecipientsByFlag(
    "gym_notifications",
    communityId,
    publishCandidates
  );
  const publishRecipientIds = await filterRecipientsByInAppPref(
    "social_post_published",
    publishFlagPassed
  );
  if (publishRecipientIds.length) {
    const rows = publishRecipientIds.map((rid) => ({
      recipientId: rid,
      actorId: user.id,
      kind: "social_post_published" as const,
      communityId,
      gymPostId: post.id,
    }));
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
        console.error("[gym-posts] dispatch failed", err);
      }
    }
  }

  // Mention notifications.
  if (mentions.length) {
    const mentionCandidates = mentions.filter((id) => id !== user.id);
    const mentionFlagPassed = await filterRecipientsByFlag(
      "gym_notifications",
      communityId,
      mentionCandidates
    );
    const mentionRecipientIds = await filterRecipientsByInAppPref(
      "social_post_mention",
      mentionFlagPassed
    );
    if (mentionRecipientIds.length) {
      const rows = mentionRecipientIds.map((id) => ({
        recipientId: id,
        actorId: user.id,
        kind: "social_post_mention" as const,
        communityId,
        gymPostId: post.id,
      }));
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
          console.error("[gym-posts] mention dispatch failed", err);
        }
      }
    }
  }

  return NextResponse.json(post, { status: 201 });
}
