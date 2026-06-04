// POST/DELETE /api/gym-posts/[id]/reactions
//
// Toggle a reaction on a gym post. Idempotent. Fires
// social_post_reaction notification on first insert (skipped if author
// reacts to their own post).

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  gymPosts,
  gymPostReactions,
  notifications,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canViewGym } from "@/lib/authz/community";
import { inngest } from "@/inngest/client";
import { isFlagOn } from "@/lib/feature-flags";
import { isInAppEnabled } from "@/lib/notifications/preferences";

const ALLOWED = new Set(["fire"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: postId } = await params;
  const body = await req.json().catch(() => ({}));
  const reaction = typeof body.reaction === "string" ? body.reaction : "fire";
  if (!ALLOWED.has(reaction)) {
    return NextResponse.json({ error: "Unsupported reaction" }, { status: 400 });
  }
  const [post] = await db
    .select({ communityId: gymPosts.communityId, authorId: gymPosts.authorId })
    .from(gymPosts)
    .where(eq(gymPosts.id, postId))
    .limit(1);
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canViewGym(user.id, post.communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(gymPostReactions)
      .values({ postId, userId: user.id, reaction })
      .onConflictDoUpdate({
        target: [
          gymPostReactions.postId,
          gymPostReactions.userId,
          gymPostReactions.reaction,
        ],
        set: { reaction: sql`excluded.reaction` },
      })
      .returning({
        id: gymPostReactions.id,
        inserted: sql<boolean>`(xmax = 0)`,
      });
    return { reactionId: row.id, created: row.inserted === true };
  });

  // Double-gated like the other gym-context notifications: gym
  // `gym_notifications` flag (default on, kill switch) → author's per-kind
  // `inAppEnabled` (default OFF for social_post_reaction). Self-reactions
  // are skipped regardless.
  if (
    result.created &&
    post.authorId !== user.id &&
    (await isFlagOn("gym_notifications", {
      userId: post.authorId,
      communityId: post.communityId,
    })) &&
    (await isInAppEnabled(post.authorId, "social_post_reaction"))
  ) {
    const [n] = await db
      .insert(notifications)
      .values({
        recipientId: post.authorId,
        actorId: user.id,
        kind: "social_post_reaction",
        gymPostId: postId,
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
      console.error("[gym-post-reactions] dispatch failed", err);
    }
  }

  return NextResponse.json(
    { reactionId: result.reactionId, created: result.created },
    { status: result.created ? 201 : 200 }
  );
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: postId } = await params;
  const url = new URL(req.url);
  const reaction = url.searchParams.get("reaction") ?? "fire";
  if (!ALLOWED.has(reaction)) {
    return NextResponse.json({ error: "Unsupported reaction" }, { status: 400 });
  }
  await db
    .delete(gymPostReactions)
    .where(
      and(
        eq(gymPostReactions.postId, postId),
        eq(gymPostReactions.userId, user.id),
        eq(gymPostReactions.reaction, reaction)
      )
    );
  return new NextResponse(null, { status: 204 });
}
