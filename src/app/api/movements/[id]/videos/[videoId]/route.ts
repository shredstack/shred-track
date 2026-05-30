// Single CrossFit movement video — GET (signed playback URL), DELETE,
// PATCH (edit label/order). Mirrors the recovery flow exactly.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { crossfitMovementVideos, communityMemberships } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { isSuperAdmin, canProgramForGym } from "@/lib/authz/community";
import {
  createPlaybackUrl,
  deleteStorageObject,
} from "@/lib/crossfit/video-storage";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; videoId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { videoId } = await params;

  const [video] = await db
    .select()
    .from(crossfitMovementVideos)
    .where(eq(crossfitMovementVideos.id, videoId))
    .limit(1);
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (video.visibility === "gym") {
    const ok =
      (await isSuperAdmin(user.id)) ||
      (await db
        .select({ id: communityMemberships.id })
        .from(communityMemberships)
        .where(
          and(
            eq(communityMemberships.userId, user.id),
            eq(communityMemberships.communityId, video.communityId!),
            eq(communityMemberships.isActive, true)
          )
        )
        .limit(1)
        .then((rows) => rows.length > 0));
    if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } else if (video.visibility === "private") {
    const ok = video.uploadedBy === user.id || (await isSuperAdmin(user.id));
    if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (video.sourceType === "external") {
    return NextResponse.json({
      url: video.externalUrl,
      provider: video.externalProvider,
      videoId: video.externalVideoId,
      external: true,
    });
  }

  if (!video.storagePath) {
    return NextResponse.json({ error: "Video has no storage path" }, { status: 500 });
  }

  try {
    const url = await createPlaybackUrl(video.storagePath);
    return NextResponse.json({ url, external: false });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to sign URL";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; videoId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { videoId } = await params;

  const [video] = await db
    .select()
    .from(crossfitMovementVideos)
    .where(eq(crossfitMovementVideos.id, videoId))
    .limit(1);
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let canDelete = false;
  if (await isSuperAdmin(user.id)) canDelete = true;
  else if (video.uploadedBy === user.id) canDelete = true;
  else if (video.communityId) canDelete = await canProgramForGym(user.id, video.communityId);

  if (!canDelete) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (video.storagePath) {
    try {
      await deleteStorageObject(video.storagePath);
    } catch (e) {
      console.warn("[crossfit] failed to remove storage object", e);
    }
  }

  await db.delete(crossfitMovementVideos).where(eq(crossfitMovementVideos.id, videoId));
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; videoId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { videoId } = await params;

  const [video] = await db
    .select()
    .from(crossfitMovementVideos)
    .where(eq(crossfitMovementVideos.id, videoId))
    .limit(1);
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let canEdit = false;
  if (await isSuperAdmin(user.id)) canEdit = true;
  else if (video.uploadedBy === user.id) canEdit = true;
  else if (video.communityId) canEdit = await canProgramForGym(user.id, video.communityId);

  if (!canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const updates: Record<string, unknown> = {};
  if (typeof body.label === "string" || body.label === null) updates.label = body.label;
  if (typeof body.orderIndex === "number") updates.orderIndex = body.orderIndex;

  const [updated] = await db
    .update(crossfitMovementVideos)
    .set(updates)
    .where(eq(crossfitMovementVideos.id, videoId))
    .returning();

  return NextResponse.json(updated);
}
