// Per-document admin API (PR 3 §3.2).
//
// GET    /api/gym/[id]/documents/[docId]            — admin: doc + all versions
// PUT    /api/gym/[id]/documents/[docId]            — admin: update metadata
// POST   /api/gym/[id]/documents/[docId]/versions   — admin: publish a new version
//                                                     (see ./versions/route.ts)

import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { documents, documentVersions } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, docId } = await params;
  if (!(await canManageGym(user.id, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, docId), eq(documents.communityId, id)))
    .limit(1);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const versions = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.documentId, docId))
    .orderBy(asc(documentVersions.version));

  return NextResponse.json({ document: doc, versions });
}

export async function PUT(
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
    title?: string;
    isRequiredOnJoin?: boolean;
    isActive?: boolean;
  } | null;

  const updates: Record<string, unknown> = {};
  if (typeof body?.title === "string" && body.title.trim()) {
    updates.title = body.title.trim();
  }
  if (typeof body?.isRequiredOnJoin === "boolean") {
    updates.isRequiredOnJoin = body.isRequiredOnJoin;
  }
  if (typeof body?.isActive === "boolean") {
    updates.isActive = body.isActive;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No updates" }, { status: 400 });
  }

  const [updated] = await db
    .update(documents)
    .set(updates)
    .where(and(eq(documents.id, docId), eq(documents.communityId, id)))
    .returning();

  if (!updated)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ document: updated });
}
