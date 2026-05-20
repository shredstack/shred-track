// GET /api/family/[id]/pending-documents
//
// Returns the dependent's pending documents (sign-on-join + version
// bumps) — so the family page can render a "Documents" subsection
// for that family member. Only the account holder can call this.

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { familyMemberBelongsToHolder } from "@/lib/family";
import { getPendingDocumentsForMember } from "@/lib/documents";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const check = await familyMemberBelongsToHolder(id, user.id);
  if (!check.row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!check.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const pending = await getPendingDocumentsForMember(
    check.row.dependentUserId,
    check.row.communityId
  );
  return NextResponse.json({ pending });
}
