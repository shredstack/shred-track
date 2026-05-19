// POST /api/gym/[id]/branding/upload-url
//
// Returns a Supabase Storage signed upload URL the client can PUT a brand
// asset (logo, hero image) directly to. Admin-only.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { canAdminGym } from "@/lib/authz/community";
import {
  buildGymAssetPath,
  createGymAssetUploadUrl,
  getGymAssetPublicUrl,
  type GymAssetKind,
} from "@/lib/gym-branding/storage";

const ALLOWED_KINDS: GymAssetKind[] = ["logo", "hero", "splash", "header_bg"];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: communityId } = await params;
  if (!(await canAdminGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    kind?: string;
    ext?: string;
  } | null;
  if (!body?.kind || !ALLOWED_KINDS.includes(body.kind as GymAssetKind)) {
    return NextResponse.json(
      { error: `kind must be one of ${ALLOWED_KINDS.join(", ")}` },
      { status: 400 }
    );
  }

  const path = buildGymAssetPath(
    communityId,
    body.kind as GymAssetKind,
    body.ext ?? "png"
  );
  const upload = await createGymAssetUploadUrl(path);
  const publicUrl = getGymAssetPublicUrl(path);

  return NextResponse.json({
    path,
    publicUrl,
    signedUrl: upload.signedUrl,
    token: upload.token,
  });
}
