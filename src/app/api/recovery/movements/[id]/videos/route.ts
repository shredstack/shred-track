import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { recoveryMovementVideos, recoveryMovements, communityMemberships } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getSessionUser } from "@/lib/session";
import { isSuperAdmin } from "@/lib/authz/community";
import { getMovementAccess } from "@/lib/authz/recovery";
import {
  buildStoragePath,
  createUploadUrl,
  parseExternalVideo,
} from "@/lib/recovery/storage";

// GET — list videos visible to caller for a given movement.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const access = await getMovementAccess(user.id, id);
  if (!access.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!access.canRead) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const memberships = await db
    .select({ communityId: communityMemberships.communityId })
    .from(communityMemberships)
    .where(
      and(eq(communityMemberships.userId, user.id), eq(communityMemberships.isActive, true))
    );
  const myGyms = memberships.map((m) => m.communityId);

  const videos = await db
    .select()
    .from(recoveryMovementVideos)
    .where(eq(recoveryMovementVideos.movementId, id))
    .orderBy(recoveryMovementVideos.orderIndex, recoveryMovementVideos.createdAt);

  const visible = videos.filter((v) => {
    if (v.visibility === "public") return true;
    if (v.visibility === "gym" && v.communityId && myGyms.includes(v.communityId)) return true;
    return false;
  });

  return NextResponse.json(visible);
}

// POST — three modes:
//   { kind: 'upload', visibility, communityId?, fileExt }
//      → returns { videoId, storagePath, uploadUrl, token }
//   { kind: 'register', videoId, durationSeconds?, label?, rightsConfirmed }
//      → finalizes the row after the client uploads
//   { kind: 'external', externalUrl, visibility, communityId?, label?, rightsConfirmed }
//      → inserts an external-URL row immediately
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [movement] = await db
    .select()
    .from(recoveryMovements)
    .where(eq(recoveryMovements.id, id))
    .limit(1);
  if (!movement) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const kind = body.kind;
  const userId = user.id;
  const superAdmin = await isSuperAdmin(userId);

  // Visibility/community combo gating, used by 'upload' and 'external' modes.
  async function checkVisibility(visibility: string, communityId: string | null): Promise<string | null> {
    if (visibility === "public") {
      if (communityId !== null) return "Public videos cannot have a community_id";
      // Members can never publish public — only super admins or any
      // coach/admin (who pass canProgramForGym in any of their gyms).
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
      // Caller must be an active member of the gym (any role).
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
        // Client uses the token + path with the JS SDK's uploadToSignedUrl().
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Upload URL creation failed";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  if (kind === "register") {
    // Finalize the row after the client has PUT the file.
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
      .insert(recoveryMovementVideos)
      .values({
        id: videoId,
        movementId: id,
        sourceType: "upload",
        storagePath,
        visibility,
        communityId,
        label: body.label ?? null,
        durationSeconds: body.durationSeconds ?? null,
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
      .insert(recoveryMovementVideos)
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
