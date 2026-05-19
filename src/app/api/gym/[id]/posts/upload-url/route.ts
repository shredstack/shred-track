// POST /api/gym/[id]/posts/upload-url
//
// Issue a signed upload URL for a gym social attachment. Returns the
// signed URL + the eventual public URL so the client can fire off the
// upload, then POST the post with the attachment URL.
//
// Members can upload (memes/announcements). Whiteboard kind is restricted
// at the create-post endpoint, not here.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { canViewGym } from "@/lib/authz/community";
import {
  buildGymSocialPath,
  createGymSocialUploadUrl,
  getGymSocialPublicUrl,
} from "@/lib/gym-social/storage";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId } = await params;
  if (!(await canViewGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const kind =
    body.kind === "whiteboard" || body.kind === "meme" || body.kind === "post"
      ? body.kind
      : "post";
  const ext = typeof body.ext === "string" ? body.ext : "jpg";

  const path = buildGymSocialPath(communityId, kind, ext);
  const signed = await createGymSocialUploadUrl(path);
  const publicUrl = getGymSocialPublicUrl(path);
  return NextResponse.json({ ...signed, path, publicUrl });
}
