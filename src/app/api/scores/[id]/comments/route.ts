import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { scoreComments, scores, users } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import {
  canInteractWithScore,
  validateMentionTargets,
} from "@/lib/authz/social";
import { mentionsMatch } from "@/lib/social/mentions";
import { inngest } from "@/inngest/client";
import type { CommentDisplay, CommentMention } from "@/types/social";

const MAX_BODY_LEN = 2_000;
const MAX_MENTIONS = 10;

interface AttachmentInput {
  provider: string;
  kind: string;
  id: string;
  url: string;
  previewUrl: string;
  width: number;
  height: number;
}

// Hardcoded hostname allowlist for Klipy CDN URLs. See spec §4.3 Q8.
// Anything not on this list is rejected at write time so we don't end up
// rendering arbitrary third-party image URLs from a malicious client.
const KLIPY_HOSTS = new Set<string>([
  "media.klipy.co",
  "cdn.klipy.com",
  "klipy.co",
]);

function validateAttachment(
  raw: unknown
): { ok: true; value: AttachmentInput } | { ok: false; error: string } {
  if (raw == null) return { ok: false, error: "Empty attachment" };
  if (typeof raw !== "object") return { ok: false, error: "Invalid attachment" };
  const a = raw as Record<string, unknown>;
  if (a.provider !== "klipy") {
    return { ok: false, error: "Unsupported attachment provider" };
  }
  if (!["gif", "meme", "sticker"].includes(a.kind as string)) {
    return { ok: false, error: "Unsupported attachment kind" };
  }
  if (
    typeof a.id !== "string" ||
    typeof a.url !== "string" ||
    typeof a.previewUrl !== "string"
  ) {
    return { ok: false, error: "Invalid attachment fields" };
  }
  const w = Number(a.width);
  const h = Number(a.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0 || w > 4096 || h > 4096) {
    return { ok: false, error: "Invalid attachment dimensions" };
  }
  for (const u of [a.url, a.previewUrl] as string[]) {
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== "https:") {
        return { ok: false, error: "Attachment URL must be https" };
      }
      if (!KLIPY_HOSTS.has(parsed.hostname.toLowerCase())) {
        return { ok: false, error: "Attachment URL host not allowed" };
      }
    } catch {
      return { ok: false, error: "Malformed attachment URL" };
    }
  }
  return {
    ok: true,
    value: {
      provider: "klipy",
      kind: a.kind as string,
      id: a.id,
      url: a.url,
      previewUrl: a.previewUrl,
      width: Math.round(w),
      height: Math.round(h),
    },
  };
}

// GET /api/scores/:id/comments
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: scoreId } = await params;

  const { allowed, ctx } = await canInteractWithScore(user.id, scoreId);
  if (!ctx) {
    return NextResponse.json({ error: "Score not found" }, { status: 404 });
  }
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await db
    .select({
      id: scoreComments.id,
      scoreId: scoreComments.scoreId,
      userId: scoreComments.userId,
      userName: users.name,
      userUsername: users.username,
      userImage: users.image,
      body: scoreComments.body,
      mentionedUserIds: scoreComments.mentionedUserIds,
      attachmentProvider: scoreComments.attachmentProvider,
      attachmentKind: scoreComments.attachmentKind,
      attachmentId: scoreComments.attachmentId,
      attachmentUrl: scoreComments.attachmentUrl,
      attachmentPreviewUrl: scoreComments.attachmentPreviewUrl,
      attachmentWidth: scoreComments.attachmentWidth,
      attachmentHeight: scoreComments.attachmentHeight,
      createdAt: scoreComments.createdAt,
      updatedAt: scoreComments.updatedAt,
    })
    .from(scoreComments)
    .innerJoin(users, eq(users.id, scoreComments.userId))
    .where(
      and(eq(scoreComments.scoreId, scoreId), isNull(scoreComments.deletedAt))
    )
    .orderBy(asc(scoreComments.createdAt));

  // Resolve mention display names in one round trip.
  const allIds = new Set<string>();
  for (const r of rows) for (const id of r.mentionedUserIds) allIds.add(id);
  const mentionMap = new Map<string, CommentMention>();
  if (allIds.size > 0) {
    const mentionRows = await db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
      })
      .from(users)
      .where(inArray(users.id, [...allIds]));
    for (const m of mentionRows) {
      mentionMap.set(m.id, {
        userId: m.id,
        name: m.name,
        username: m.username,
      });
    }
  }

  const comments: CommentDisplay[] = rows.map((r) => ({
    id: r.id,
    scoreId: r.scoreId,
    userId: r.userId,
    userName: r.userName,
    userUsername: r.userUsername,
    userImage: r.userImage,
    body: r.body,
    mentions: r.mentionedUserIds
      .map((id) => mentionMap.get(id))
      .filter((m): m is CommentMention => !!m),
    attachment:
      r.attachmentProvider && r.attachmentId && r.attachmentUrl
        ? {
            provider: "klipy" as const,
            kind: (r.attachmentKind ?? "gif") as "gif" | "meme" | "sticker",
            id: r.attachmentId,
            url: r.attachmentUrl,
            previewUrl: r.attachmentPreviewUrl ?? r.attachmentUrl,
            width: r.attachmentWidth ?? 0,
            height: r.attachmentHeight ?? 0,
          }
        : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    isEdited: r.updatedAt.getTime() - r.createdAt.getTime() > 1_000,
    isOwn: r.userId === user.id,
  }));

  return NextResponse.json({ comments });
}

// POST /api/scores/:id/comments
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: scoreId } = await params;

  const { allowed, ctx } = await canInteractWithScore(user.id, scoreId);
  if (!ctx) {
    return NextResponse.json({ error: "Score not found" }, { status: 404 });
  }
  if (!allowed || !ctx.communityId) {
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

  // Mention tokens in body must match `mentionedUserIds[]` exactly.
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

  let attachment: AttachmentInput | null = null;
  if (raw.attachment != null) {
    const v = validateAttachment(raw.attachment);
    if (!v.ok) {
      return NextResponse.json({ error: v.error }, { status: 400 });
    }
    attachment = v.value;
  }

  if (body.trim().length === 0 && !attachment) {
    return NextResponse.json(
      { error: "Comment must have body or attachment" },
      { status: 400 }
    );
  }

  const insertedId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(scoreComments)
      .values({
        scoreId,
        userId: user.id,
        body,
        mentionedUserIds,
        ...(attachment
          ? {
              attachmentProvider: attachment.provider,
              attachmentKind: attachment.kind,
              attachmentId: attachment.id,
              attachmentUrl: attachment.url,
              attachmentPreviewUrl: attachment.previewUrl,
              attachmentWidth: attachment.width,
              attachmentHeight: attachment.height,
            }
          : {}),
      })
      .returning({ id: scoreComments.id });

    await tx
      .update(scores)
      .set({ commentCount: sql`${scores.commentCount} + 1` })
      .where(eq(scores.id, scoreId));

    return row.id;
  });

  // Fire-and-forget notification fan-out. Failure must not roll back the
  // comment — the row is already durable.
  try {
    await inngest.send({
      // Idempotency key on the comment id — a duplicate POST that somehow
      // gets retried after insert (or replays from a queue) won't fan out
      // notifications twice.
      id: `comment-created:${insertedId}`,
      name: "social/comment.created",
      data: {
        commentId: insertedId,
        scoreId,
        actorId: user.id,
        mentionedUserIds,
      },
    });
  } catch (err) {
    console.error("[comments] inngest send failed", err);
  }

  return NextResponse.json({ commentId: insertedId }, { status: 201 });
}
