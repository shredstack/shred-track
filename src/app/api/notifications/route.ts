import { NextRequest, NextResponse } from "next/server";
import { aliasedTable, and, desc, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  notifications,
  scoreComments,
  users,
  workouts,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import type { NotificationDisplay, NotificationKind } from "@/types/social";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

// GET /api/notifications?cursor=<iso>&limit=50
//
// Paginated by createdAt cursor (descending). Returns the recipient's
// notifications scoped by the RLS policy too.
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const limit = Math.min(
    Math.max(1, Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT) | 0),
    MAX_LIMIT
  );
  const cursor = url.searchParams.get("cursor");

  const actor = aliasedTable(users, "actor");

  const rows = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      scoreId: notifications.scoreId,
      commentId: notifications.commentId,
      workoutId: notifications.workoutId,
      workoutPartId: notifications.workoutPartId,
      actorId: notifications.actorId,
      actorName: actor.name,
      actorImage: actor.image,
      workoutTitle: workouts.title,
      workoutDate: workouts.workoutDate,
      commentBody: scoreComments.body,
      commentHasAttachment: sql<boolean>`${scoreComments.attachmentProvider} IS NOT NULL`,
    })
    .from(notifications)
    .leftJoin(actor, eq(actor.id, notifications.actorId))
    .leftJoin(workouts, eq(workouts.id, notifications.workoutId))
    .leftJoin(scoreComments, eq(scoreComments.id, notifications.commentId))
    .where(
      and(
        eq(notifications.recipientId, user.id),
        cursor
          ? lt(notifications.createdAt, new Date(cursor))
          : undefined
      )
    )
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  const items: NotificationDisplay[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind as NotificationKind,
    actorName: r.actorName ?? null,
    actorImage: r.actorImage ?? null,
    workoutTitle: r.workoutTitle ?? "",
    workoutDate: r.workoutDate ?? null,
    workoutId: r.workoutId ?? "",
    workoutPartId: r.workoutPartId ?? null,
    scoreId: r.scoreId ?? null,
    commentId: r.commentId ?? null,
    bodyPreview:
      r.commentBody
        ? r.commentBody
            .replace(/\[mention:[0-9a-f-]{36}\]/gi, "@user")
            .slice(0, 80)
        : undefined,
    hasAttachment: r.commentHasAttachment ?? undefined,
    readAt: r.readAt ? r.readAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));

  const nextCursor =
    items.length === limit && rows.length > 0
      ? rows[rows.length - 1].createdAt.toISOString()
      : null;

  return NextResponse.json({ items, nextCursor });
}
