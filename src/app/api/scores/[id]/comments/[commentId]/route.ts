import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { scoreComments, scores } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import {
  canInteractWithScore,
  validateMentionTargets,
} from "@/lib/authz/social";
import { mentionsMatch, parseMentionsFromBody } from "@/lib/social/mentions";
import { inngest } from "@/inngest/client";

const MAX_BODY_LEN = 2_000;
const MAX_MENTIONS = 10;

// PATCH /api/scores/:id/comments/:commentId
//
// Author-only edit. Same validation as POST. Updates `updated_at`, and if
// any new mentions appear, fires `social/comment.mentioned` per spec Q3 so
// newly-tagged users get notified.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: scoreId, commentId } = await params;

  const { allowed, ctx } = await canInteractWithScore(user.id, scoreId);
  if (!ctx) {
    return NextResponse.json({ error: "Score not found" }, { status: 404 });
  }
  if (!allowed || !ctx.communityId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [existing] = await db
    .select({
      userId: scoreComments.userId,
      mentionedUserIds: scoreComments.mentionedUserIds,
    })
    .from(scoreComments)
    .where(
      and(
        eq(scoreComments.id, commentId),
        eq(scoreComments.scoreId, scoreId),
        isNull(scoreComments.deletedAt)
      )
    )
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }
  if (existing.userId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }

  const body = typeof raw.body === "string" ? raw.body : "";
  if (body.length > MAX_BODY_LEN) {
    return NextResponse.json(
      { error: `Body exceeds ${MAX_BODY_LEN} characters` },
      { status: 400 }
    );
  }
  const rawMentions: unknown[] = Array.isArray(raw.mentionedUserIds)
    ? raw.mentionedUserIds
    : [];
  const mentionedUserIds: string[] = Array.from(
    new Set(
      rawMentions.filter(
        (x: unknown): x is string => typeof x === "string"
      )
    )
  );
  if (mentionedUserIds.length > MAX_MENTIONS) {
    return NextResponse.json(
      { error: `Too many mentions (max ${MAX_MENTIONS})` },
      { status: 400 }
    );
  }
  if (!mentionsMatch(body, mentionedUserIds)) {
    return NextResponse.json(
      { error: "Mention tokens in body do not match mentionedUserIds" },
      { status: 400 }
    );
  }
  if (mentionedUserIds.length > 0) {
    const check = await validateMentionTargets(
      mentionedUserIds,
      ctx.communityId
    );
    if (!check.valid) {
      return NextResponse.json(
        { error: "One or more mentioned users are not gym members" },
        { status: 400 }
      );
    }
  }

  // We accept the same attachment field as POST but for v1 edits we only
  // support text/mention changes — the picker UI lives in the create flow.
  // Skipping attachment updates here keeps the surface smaller.

  await db
    .update(scoreComments)
    .set({
      body,
      mentionedUserIds,
      updatedAt: new Date(),
    })
    .where(eq(scoreComments.id, commentId));

  // Mentions added on edit get a notification per spec Q3.
  const prevIds = new Set(parseMentionsFromBody(""));
  for (const id of existing.mentionedUserIds) prevIds.add(id.toLowerCase());
  const newlyMentioned = mentionedUserIds
    .map((id) => id.toLowerCase())
    .filter((id) => !prevIds.has(id));
  if (newlyMentioned.length > 0) {
    // Idempotency key includes the sorted set of newly-mentioned ids so a
    // retried PATCH with the same body dedupes, but a follow-up edit that
    // adds a different user still fires.
    const dedupSuffix = [...newlyMentioned].sort().join(",");
    try {
      await inngest.send({
        id: `comment-mentioned:${commentId}:${dedupSuffix}`,
        name: "social/comment.mentioned",
        data: {
          commentId,
          scoreId,
          actorId: user.id,
          mentionedUserIds: newlyMentioned,
        },
      });
    } catch (err) {
      console.error("[comments] inngest mentioned-on-edit send failed", err);
    }
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/scores/:id/comments/:commentId
//
// Soft delete via `deleted_at`. Decrements comment_count only when we
// actually flipped a row (idempotent — second DELETE is a no-op).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: scoreId, commentId } = await params;

  const { allowed, ctx } = await canInteractWithScore(user.id, scoreId);
  if (!ctx) {
    return NextResponse.json({ error: "Score not found" }, { status: 404 });
  }
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.transaction(async (tx) => {
    const deleted = await tx
      .update(scoreComments)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(scoreComments.id, commentId),
          eq(scoreComments.scoreId, scoreId),
          eq(scoreComments.userId, user.id),
          isNull(scoreComments.deletedAt)
        )
      )
      .returning({ id: scoreComments.id });
    if (deleted.length > 0) {
      await tx
        .update(scores)
        .set({
          commentCount: sql`GREATEST(${scores.commentCount} - 1, 0)`,
        })
        .where(eq(scores.id, scoreId));
    }
  });

  return new NextResponse(null, { status: 204 });
}
