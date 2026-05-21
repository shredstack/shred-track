// POST /api/communities/[id]/documents/[versionId]/sign
//
// Records the current user's signature for a specific document version.
// If, after the signature lands, the user has no remaining required-on-
// join pending documents AND their membership was sitting inactive
// (pending docs), the membership flips to active.
//
// Sign-on-behalf (dependents spec §3.5 / §4.8): if the body includes
// `subjectUserId`, the signer is a guardian signing for a minor
// dependent. We validate the family link + minor status before storing.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  communities,
  communityMemberships,
  documents,
  documentSignatures,
  documentVersions,
  familyMembers,
  users,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { getPendingDocuments } from "@/lib/documents";
import { isMinor } from "@/lib/family";
import { resolveGymTimezone } from "@/lib/timezone";

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
    subjectUserId?: string;
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

  // Sign-on-behalf branch (dependents spec §4.8).
  let subjectUserId: string | null = null;
  let signedOnBehalfMeta: Record<string, unknown> | null = null;
  if (body.subjectUserId && body.subjectUserId !== user.id) {
    subjectUserId = body.subjectUserId;

    // The current user must be the family-link account holder for the
    // subject in this gym.
    const [link] = await db
      .select({ id: familyMembers.id })
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.accountHolderUserId, user.id),
          eq(familyMembers.dependentUserId, subjectUserId),
          eq(familyMembers.communityId, id)
        )
      )
      .limit(1);
    if (!link) {
      return NextResponse.json(
        { error: "Forbidden — not the guardian on file" },
        { status: 403 }
      );
    }

    // Subject must be a minor — adult dependents sign themselves.
    const [subject] = await db
      .select({ dob: users.dateOfBirth })
      .from(users)
      .where(eq(users.id, subjectUserId))
      .limit(1);
    const [gym] = await db
      .select({ timezone: communities.gymTimezone })
      .from(communities)
      .where(eq(communities.id, id))
      .limit(1);
    if (!subject || !subject.dob) {
      return NextResponse.json(
        { error: "Set the dependent's date of birth before signing" },
        { status: 400 }
      );
    }
    if (!isMinor(subject.dob, resolveGymTimezone(gym?.timezone))) {
      return NextResponse.json(
        { error: "adult_dependents_sign_themselves" },
        { status: 403 }
      );
    }

    signedOnBehalfMeta = {
      kind: "parent_of_minor",
      guardian_user_id: user.id,
      guardian_typed_name: typedName,
      minor_user_id: subjectUserId,
      minor_dob_at_signing: subject.dob,
      signed_at: new Date().toISOString(),
    };
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
  if (signedOnBehalfMeta && ip) signedOnBehalfMeta.signed_ip = ip;

  await db
    .insert(documentSignatures)
    .values({
      documentVersionId: versionId,
      userId: user.id,
      subjectUserId,
      signedOnBehalfReason: subjectUserId ? "parent_of_minor" : null,
      signedOnBehalfMeta,
      typedName,
      signedIp: ip,
    })
    // The unique constraint is on (version, coalesce(subject, user))
    // so a self-sign and a sign-on-behalf for a different minor both
    // succeed; re-signing the same waiver no-ops.
    .onConflictDoNothing();

  // If a guardian signed on behalf of a dependent, check the
  // dependent's pending list to potentially activate THEIR membership.
  if (subjectUserId) {
    const [depMembership] = await db
      .select({
        id: communityMemberships.id,
        isActive: communityMemberships.isActive,
      })
      .from(communityMemberships)
      .where(
        and(
          eq(communityMemberships.communityId, id),
          eq(communityMemberships.userId, subjectUserId)
        )
      )
      .limit(1);
    if (depMembership && !depMembership.isActive) {
      const pending = await getPendingDocuments(subjectUserId, id, true);
      if (pending.length === 0) {
        await db
          .update(communityMemberships)
          .set({ isActive: true, deactivatedAt: null })
          .where(eq(communityMemberships.id, depMembership.id));
      }
    }
  } else if (!membership.isActive) {
    // Self-sign: if the signer was sitting inactive (pending docs) and
    // all required-on-join docs are now signed, activate the membership.
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
