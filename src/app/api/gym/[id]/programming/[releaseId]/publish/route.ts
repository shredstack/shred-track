// POST /api/gym/[id]/programming/[releaseId]/publish
//
// Flips a draft release to published. Coach/admin only (spec uses
// canPublishProgramming alias; we delegate to canManageGym for v1).
// Also flips workouts.published=true for every workout tied to the
// release so the member-facing CrossFit GET returns them.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { programmingReleases, workouts } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";

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

  await db.transaction(async (tx) => {
    await tx
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
      );

    await tx
      .update(workouts)
      .set({ published: true, updatedAt: new Date() })
      .where(eq(workouts.programmingReleaseId, releaseId));
  });

  return NextResponse.json({ ok: true });
}
