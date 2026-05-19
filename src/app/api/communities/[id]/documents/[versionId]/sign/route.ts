// POST /api/communities/[id]/documents/[versionId]/sign
//
// Records the current user's signature for a specific document version.
// If, after the signature lands, the user has no remaining required-on-
// join pending documents AND their membership was sitting inactive
// (pending docs), the membership flips to active.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  communityMemberships,
  documents,
  documentSignatures,
  documentVersions,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { getPendingDocuments } from "@/lib/documents";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, versionId } = await params;

  const [membership] = await db
    .select({ id: communityMemberships.id, isActive: communityMemberships.isActive })
    .from(communityMemberships)
    .where(
      and(
        eq(communityMemberships.communityId, id),
        eq(communityMemberships.userId, user.id)
      )
    )
    .limit(1);
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    typedName?: string;
  } | null;
  if (!body?.typedName || typeof body.typedName !== "string") {
    return NextResponse.json(
      { error: "typedName is required" },
      { status: 400 }
    );
  }
  const typedName = body.typedName.trim();
  if (!typedName) {
    return NextResponse.json(
      { error: "typedName is required" },
      { status: 400 }
    );
  }

  // Confirm the version belongs to a document in *this* community —
  // otherwise a member of gym A could sign gym B's waiver.
  const [version] = await db
    .select({
      id: documentVersions.id,
      documentId: documentVersions.documentId,
      communityId: documents.communityId,
    })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(eq(documentVersions.id, versionId))
    .limit(1);
  if (!version || version.communityId !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Extract client IP from common forwarding headers — best-effort.
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;

  await db
    .insert(documentSignatures)
    .values({
      documentVersionId: versionId,
      userId: user.id,
      typedName,
      signedIp: ip,
    })
    .onConflictDoNothing();

  // If the membership was pending docs (isActive=false because of
  // sign-on-join, set by the join API) and all required-on-join docs
  // are now signed, activate the membership.
  if (!membership.isActive) {
    const pending = await getPendingDocuments(user.id, id, true);
    if (pending.length === 0) {
      await db
        .update(communityMemberships)
        .set({ isActive: true, deactivatedAt: null })
        .where(eq(communityMemberships.id, membership.id));
    }
  }

  return NextResponse.json({ ok: true });
}
