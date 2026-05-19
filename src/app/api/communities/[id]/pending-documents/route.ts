// GET /api/communities/[id]/pending-documents
//
// Returns the documents the *current user* still needs to sign for this
// gym. Includes both first-time sign (on join) and re-sign on update
// cases. The home banner + /gym/[slug]/sign-documents page both read
// from this endpoint.
//
// Authz: the user must have a membership row for the gym (active or
// inactive — an inactive new join still needs to sign).

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { communityMemberships } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { getPendingDocuments } from "@/lib/documents";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const [membership] = await db
    .select({ id: communityMemberships.id })
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

  const pending = await getPendingDocuments(user.id, id);
  return NextResponse.json({ pending });
}
