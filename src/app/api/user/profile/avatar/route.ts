import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import {
  buildAvatarPath,
  createUploadUrl,
  deleteAvatarObject,
  getPublicUrl,
  pathFromPublicUrl,
} from "@/lib/avatars/storage";

// Two-step direct-to-storage upload, mirroring the recovery-videos
// pattern but for the public-read `avatars` bucket:
//
//   POST { kind: 'upload' }
//      → { storagePath, uploadUrl, token, publicUrl }
//      Client PUTs the (already cropped + compressed) blob to uploadUrl
//      via supabase.storage.uploadToSignedUrl().
//
//   POST { kind: 'finalize', storagePath }
//      → { image }
//      Writes the public URL to users.image and deletes the previous
//      avatar object (if any) so we don't accumulate orphans.
export async function POST(req: NextRequest) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (body.kind === "upload") {
    const storagePath = buildAvatarPath(session.id);
    try {
      const uploadInfo = await createUploadUrl(storagePath);
      const publicUrl = getPublicUrl(storagePath);
      return NextResponse.json({
        storagePath,
        uploadUrl: uploadInfo.signedUrl,
        token: uploadInfo.token,
        publicUrl,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Upload URL creation failed";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  if (body.kind === "finalize") {
    const storagePath = body.storagePath;
    if (typeof storagePath !== "string" || !storagePath.startsWith(`users/${session.id}/`)) {
      // Scope check: the client cannot finalize a path that doesn't belong
      // to the authenticated user, even if the upload URL was somehow leaked.
      return NextResponse.json({ error: "Invalid storage path" }, { status: 400 });
    }

    const newPublicUrl = getPublicUrl(storagePath);

    const [previous] = await db
      .select({ image: users.image })
      .from(users)
      .where(eq(users.id, session.id))
      .limit(1);

    const [updated] = await db
      .update(users)
      .set({ image: newPublicUrl, updatedAt: new Date() })
      .where(eq(users.id, session.id))
      .returning({ image: users.image });

    // Best-effort cleanup of the previous avatar. We swallow errors so a
    // failed delete (object missing, transient storage hiccup) never
    // blocks the user from seeing their new picture.
    if (previous?.image && previous.image !== newPublicUrl) {
      const oldPath = pathFromPublicUrl(previous.image);
      if (oldPath) {
        try {
          await deleteAvatarObject(oldPath);
        } catch {
          // ignore
        }
      }
    }

    return NextResponse.json({ image: updated.image });
  }

  return NextResponse.json({ error: "Unknown kind" }, { status: 400 });
}

// DELETE — clear the avatar (revert to initials fallback).
export async function DELETE() {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [previous] = await db
    .select({ image: users.image })
    .from(users)
    .where(eq(users.id, session.id))
    .limit(1);

  await db
    .update(users)
    .set({ image: null, updatedAt: new Date() })
    .where(eq(users.id, session.id));

  if (previous?.image) {
    const oldPath = pathFromPublicUrl(previous.image);
    if (oldPath) {
      try {
        await deleteAvatarObject(oldPath);
      } catch {
        // ignore
      }
    }
  }

  return NextResponse.json({ image: null });
}
