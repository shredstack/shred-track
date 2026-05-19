// GET /api/gym/[id]/posts/review
//
// List pending_review gym posts for the coach review queue. Coach/admin
// only.

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { gymPosts, users } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const rows = await db
    .select({
      id: gymPosts.id,
      kind: gymPosts.kind,
      body: gymPosts.body,
      authorId: gymPosts.authorId,
      authorName: users.name,
      createdAt: gymPosts.createdAt,
      mentionedUserIds: gymPosts.mentionedUserIds,
    })
    .from(gymPosts)
    .innerJoin(users, eq(users.id, gymPosts.authorId))
    .where(
      and(
        eq(gymPosts.communityId, communityId),
        eq(gymPosts.status, "pending_review")
      )
    )
    .orderBy(desc(gymPosts.createdAt));
  return NextResponse.json({
    posts: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
