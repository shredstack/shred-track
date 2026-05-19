// POST /api/gym/[id]/documents/[docId]/versions
//
// Publish a new version of a document (PR 3 §3.2). Each new version
// auto-increments and supersedes every prior version for re-sign
// purposes (staleness is computed on read against the latest version).

import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { documents, documentVersions } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, docId } = await params;
  if (!(await canManageGym(user.id, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    bodyMarkdown?: string;
  } | null;
  if (!body?.bodyMarkdown || typeof body.bodyMarkdown !== "string") {
    return NextResponse.json(
      { error: "bodyMarkdown is required" },
      { status: 400 }
    );
  }

  const [doc] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, docId), eq(documents.communityId, id)))
    .limit(1);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [previous] = await db
    .select({ version: documentVersions.version })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, docId))
    .orderBy(desc(documentVersions.version))
    .limit(1);
  const nextVersion = (previous?.version ?? 0) + 1;

  const [created] = await db
    .insert(documentVersions)
    .values({
      documentId: docId,
      version: nextVersion,
      bodyMarkdown: body.bodyMarkdown,
      publishedBy: user.id,
    })
    .returning();

  return NextResponse.json({ version: created }, { status: 201 });
}
