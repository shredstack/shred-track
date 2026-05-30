// CrossFit movement videos — list + create. Mirrors the recovery flow:
// list filters to videos the caller can see (public, or gym they belong
// to, or their own private); create supports three modes (upload,
// register, external) so client uploads go direct-to-storage and only
// hit our API for the visibility gate + final row insert.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { crossfitMovementVideos, movements, communityMemberships } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getSessionUser } from "@/lib/session";
import { isSuperAdmin } from "@/lib/authz/community";
import {
  buildStoragePath,
  createUploadUrl,
  parseExternalVideo,
} from "@/lib/crossfit/video-storage";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [movement] = await db
    .select({ id: movements.id })
    .from(movements)
    .where(eq(movements.id, id))
    .limit(1);
  if (!movement) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const memberships = await db
    .select({ communityId: communityMemberships.communityId })
    .from(communityMemberships)
    .where(
      and(eq(communityMemberships.userId, user.id), eq(communityMemberships.isActive, true))
    );
  const myGyms = memberships.map((m) => m.communityId);

  const videos = await db
    .select()
    .from(crossfitMovementVideos)
    .where(eq(crossfitMovementVideos.movementId, id))
    .orderBy(crossfitMovementVideos.orderIndex, crossfitMovementVideos.createdAt);

  const visible = videos.filter((v) => {
    if (v.visibility === "public") return true;
    if (v.visibility === "gym" && v.communityId && myGyms.includes(v.communityId)) return true;
    if (v.visibility === "private" && v.uploadedBy === user.id) return true;
    return false;
  });

  return NextResponse.json(visible);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [movement] = await db
    .select({ id: movements.id })
    .from(movements)
    .where(eq(movements.id, id))
    .limit(1);
  if (!movement) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const kind = body.kind;
  const userId = user.id;
  const superAdmin = await isSuperAdmin(userId);

  async function checkVisibility(visibility: string, communityId: string | null): Promise<string | null> {
    if (visibility === "public") {
      if (communityId !== null) return "Public videos cannot have a community_id";
      if (superAdmin) return null;
      const memberships = await db
        .select()
        .from(communityMemberships)
        .where(
          and(
            eq(communityMemberships.userId, userId),
            eq(communityMemberships.isActive, true)
          )
        );
      const elevated = memberships.find((m) => m.isAdmin || m.isCoach);
      if (!elevated) return "Members cannot publish public videos";
      return null;
    }
    if (visibility === "gym") {
      if (!communityId) return "gym visibility requires a communityId";
      if (superAdmin) return null;
      const [m] = await db
        .select()
        .from(communityMemberships)
        .where(
          and(
            eq(communityMemberships.userId, userId),
            eq(communityMemberships.communityId, communityId),
            eq(communityMemberships.isActive, true)
          )
        )
        .limit(1);
      if (!m) return "You are not an active member of that gym";
      return null;
    }
    if (visibility === "private") {
      if (communityId !== null) return "Private videos cannot have a community_id";
      return null;
    }
    return "Invalid visibility";
  }

  if (kind === "upload") {
    const visibility = body.visibility;
    const communityId = body.communityId ?? null;
    const err = await checkVisibility(visibility, communityId);
    if (err) return NextResponse.json({ error: err }, { status: 403 });

    const videoId = randomUUID();
    const ext = typeof body.fileExt === "string" ? body.fileExt : "mp4";
    const storagePath = buildStoragePath({
      visibility,
      communityId,
      uploadedBy: user.id,
      movementId: id,
      videoId,
      ext,
    });

    try {
      const uploadInfo = await createUploadUrl(storagePath);
      return NextResponse.json({
        videoId,
        storagePath,
        uploadUrl: uploadInfo.signedUrl,
        token: uploadInfo.token,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Upload URL creation failed";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  if (kind === "register") {
    const videoId = body.videoId;
    const storagePath = body.storagePath;
    const visibility = body.visibility;
    const communityId = body.communityId ?? null;
    if (!videoId || !storagePath) {
      return NextResponse.json({ error: "videoId and storagePath required" }, { status: 400 });
    }
    const err = await checkVisibility(visibility, communityId);
    if (err) return NextResponse.json({ error: err }, { status: 403 });

    if (!body.rightsConfirmed) {
      return NextResponse.json(
        { error: "You must confirm you have rights to share this content" },
        { status: 400 }
      );
    }

    const [row] = await db
      .insert(crossfitMovementVideos)
      .values({
        id: videoId,
        movementId: id,
        sourceType: "upload",
        storagePath,
        visibility,
        communityId,
        label: body.label ?? null,
        durationSeconds:
          typeof body.durationSeconds === "number" && Number.isFinite(body.durationSeconds)
            ? Math.round(body.durationSeconds)
            : null,
        rightsConfirmed: true,
        orderIndex: typeof body.orderIndex === "number" ? body.orderIndex : 0,
        uploadedBy: user.id,
      })
      .returning();

    return NextResponse.json(row, { status: 201 });
  }

  if (kind === "external") {
    const externalUrl = body.externalUrl;
    const visibility = body.visibility;
    const communityId = body.communityId ?? null;
    if (!externalUrl) {
      return NextResponse.json({ error: "externalUrl required" }, { status: 400 });
    }
    const err = await checkVisibility(visibility, communityId);
    if (err) return NextResponse.json({ error: err }, { status: 403 });

    if (!body.rightsConfirmed) {
      return NextResponse.json(
        { error: "You must confirm you have rights to share this content" },
        { status: 400 }
      );
    }

    const { provider, videoId: extId } = parseExternalVideo(externalUrl);

    const [row] = await db
      .insert(crossfitMovementVideos)
      .values({
        movementId: id,
        sourceType: "external",
        externalUrl,
        externalProvider: provider,
        externalVideoId: extId,
        visibility,
        communityId,
        label: body.label ?? null,
        rightsConfirmed: true,
        orderIndex: typeof body.orderIndex === "number" ? body.orderIndex : 0,
        uploadedBy: user.id,
      })
      .returning();

    return NextResponse.json(row, { status: 201 });
  }

  return NextResponse.json({ error: "Unknown kind" }, { status: 400 });
}
