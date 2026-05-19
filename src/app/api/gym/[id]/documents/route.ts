// Gym admin documents API (PR 3 §3.2).
//
// GET   /api/gym/[id]/documents          — admin: list all documents for the gym
// POST  /api/gym/[id]/documents          — admin: create a new document shell

import { NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  documents,
  documentVersions,
  DOCUMENT_KINDS,
  type DocumentKind,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await canManageGym(user.id, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await db
    .select({
      id: documents.id,
      kind: documents.kind,
      title: documents.title,
      isRequiredOnJoin: documents.isRequiredOnJoin,
      isActive: documents.isActive,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(eq(documents.communityId, id))
    .orderBy(desc(documents.createdAt));

  // Hydrate the latest published version per doc so the admin list
  // shows version count + last-published-at without a second roundtrip.
  const docIds = rows.map((r) => r.id);
  const versions = docIds.length
    ? await db
        .select({
          documentId: documentVersions.documentId,
          version: documentVersions.version,
          publishedAt: documentVersions.publishedAt,
        })
        .from(documentVersions)
        .where(inArray(documentVersions.documentId, docIds))
    : [];
  const latestByDoc = new Map<
    string,
    { version: number; publishedAt: Date }
  >();
  for (const v of versions) {
    const prev = latestByDoc.get(v.documentId);
    if (!prev || prev.version < v.version) {
      latestByDoc.set(v.documentId, {
        version: v.version,
        publishedAt: v.publishedAt,
      });
    }
  }

  return NextResponse.json({
    documents: rows.map((r) => ({
      ...r,
      latestVersion: latestByDoc.get(r.id)?.version ?? null,
      latestPublishedAt:
        latestByDoc.get(r.id)?.publishedAt?.toISOString() ?? null,
    })),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await canManageGym(user.id, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    kind?: string;
    title?: string;
    isRequiredOnJoin?: boolean;
  } | null;
  if (!body?.title || typeof body.title !== "string") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const kind = body.kind ?? "waiver";
  if (!DOCUMENT_KINDS.includes(kind as DocumentKind)) {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  }

  const [created] = await db
    .insert(documents)
    .values({
      communityId: id,
      kind,
      title: body.title.trim(),
      isRequiredOnJoin: !!body.isRequiredOnJoin,
      createdBy: user.id,
    })
    .returning();

  return NextResponse.json({ document: created }, { status: 201 });
}
