// Document-signature helpers (PR 3 §3.2 + dependents spec §3.5).
//
// A document needs a fresh signature in two cases:
//   1. Sign-on-join: a new gym member who has never signed it.
//   2. Re-sign on update: a member who signed an older version but not
//      the latest published version.
//
// Both reduce to "the subject is missing a signature for the latest
// version." Sign-on-behalf changes "subject" from "the signer" to
// "subject_user_id when set, else user_id" — getPendingDocumentsForMember
// uses that COALESCE to count guardian-signed-for-minor signatures
// against the minor's pending queue.

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents, documentVersions, documentSignatures } from "@/db/schema";

export interface PendingDocument {
  documentId: string;
  title: string;
  kind: string;
  isRequiredOnJoin: boolean;
  // The latest published version the user needs to sign. Null only if
  // the document has no versions yet (admin created the shell but
  // hasn't published any text) — in which case it's NOT included in
  // the pending list.
  versionId: string;
  versionNumber: number;
  bodyMarkdown: string;
  // True if the user has previously signed an older version. Drives the
  // copy ("review and re-sign") vs. first-sign ("sign to join").
  isResign: boolean;
}

/**
 * Returns documents from `communityId` that the user still needs to
 * sign or re-sign. Only active documents with at least one published
 * version are considered. If `requiredOnJoinOnly` is true, the result
 * is narrowed to documents marked required at join time — useful for
 * the sign-on-join gate.
 */
export async function getPendingDocuments(
  userId: string,
  communityId: string,
  requiredOnJoinOnly = false
): Promise<PendingDocument[]> {
  // Latest version per document. Reference documents.id with the table
  // qualifier so the correlation isn't shadowed by dv.id in the inner
  // scope — ${documents.id} alone renders as just "id", which Postgres
  // resolves to dv.id and silently breaks the join.
  const latestVersionSql = sql<string>`(
    SELECT dv.id FROM document_versions dv
    WHERE dv.document_id = documents.id
    ORDER BY dv.version DESC
    LIMIT 1
  )`;

  // Has the user ever signed THIS document (any version)? A signature
  // counts when either ds.user_id matches (self-signed) or
  // ds.subject_user_id matches (a guardian signed on the user's behalf,
  // dependents spec §3.5).
  const hasAnySignatureSql = sql<boolean>`EXISTS (
    SELECT 1 FROM document_signatures ds
    JOIN document_versions dv ON dv.id = ds.document_version_id
    WHERE dv.document_id = documents.id
      AND COALESCE(ds.subject_user_id, ds.user_id) = ${userId}
  )`;

  const rows = await db
    .select({
      documentId: documents.id,
      title: documents.title,
      kind: documents.kind,
      isRequiredOnJoin: documents.isRequiredOnJoin,
      latestVersionId: latestVersionSql,
      hasAnySignature: hasAnySignatureSql,
    })
    .from(documents)
    .where(
      and(
        eq(documents.communityId, communityId),
        eq(documents.isActive, true),
        requiredOnJoinOnly ? eq(documents.isRequiredOnJoin, true) : sql`true`
      )
    );

  const pending: PendingDocument[] = [];
  for (const row of rows) {
    if (!row.latestVersionId) continue;

    const [version] = await db
      .select({
        id: documentVersions.id,
        version: documentVersions.version,
        bodyMarkdown: documentVersions.bodyMarkdown,
      })
      .from(documentVersions)
      .where(eq(documentVersions.id, row.latestVersionId))
      .limit(1);
    if (!version) continue;

    // Self-signed OR signed-on-behalf — either counts as covering the
    // pending requirement for this user (dependents spec §3.5).
    const [existing] = await db
      .select({ id: documentSignatures.id })
      .from(documentSignatures)
      .where(
        and(
          eq(documentSignatures.documentVersionId, version.id),
          sql`coalesce(${documentSignatures.subjectUserId}, ${documentSignatures.userId}) = ${userId}`
        )
      )
      .limit(1);
    if (existing) continue;

    pending.push({
      documentId: row.documentId,
      title: row.title,
      kind: row.kind,
      isRequiredOnJoin: row.isRequiredOnJoin,
      versionId: version.id,
      versionNumber: version.version,
      bodyMarkdown: version.bodyMarkdown,
      isResign: row.hasAnySignature,
    });
  }

  return pending;
}

/**
 * Dependents spec §3.5 alias. Returns the same shape as
 * getPendingDocuments — kept under a more explicit name for callers
 * that walk a list of family members and ask "what's pending for each
 * of them?"
 */
export async function getPendingDocumentsForMember(
  userId: string,
  communityId: string
): Promise<PendingDocument[]> {
  return getPendingDocuments(userId, communityId);
}

/**
 * True if the user has at least one outstanding required-on-join doc
 * for the given gym. Used by the join API to decide whether to gate
 * membership.isActive on signature collection.
 */
export async function hasRequiredOnJoinDocs(
  communityId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: documents.id })
    .from(documents)
    .innerJoin(documentVersions, eq(documentVersions.documentId, documents.id))
    .where(
      and(
        eq(documents.communityId, communityId),
        eq(documents.isActive, true),
        eq(documents.isRequiredOnJoin, true)
      )
    )
    .limit(1);
  return !!row;
}

// Marker for "documents that have ever been published" — used to
// disambiguate an admin-created shell from a real document. Currently
// only consumed by tests / debugging; left in lib for symmetry.
export async function listActivePublishedDocumentIds(
  communityId: string
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: documents.id })
    .from(documents)
    .innerJoin(documentVersions, eq(documentVersions.documentId, documents.id))
    .where(
      and(
        eq(documents.communityId, communityId),
        eq(documents.isActive, true)
      )
    )
    .orderBy(desc(documents.createdAt));
  return rows.map((r) => r.id);
}

