// GET /api/gym/[id]/family
//
// Read-only family directory for coaches + admins of a gym (spec §4.7).
// Members do not see other families. Admins additionally see the
// account-holder–entered `notes` field (potentially sensitive); coaches
// don't get notes.

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import {
  canAdminGym,
  canProgramForGym,
  isSuperAdmin,
} from "@/lib/authz/community";
import { isFlagOn } from "@/lib/feature-flags";
import { listFamiliesByGym } from "@/lib/family";
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

  // Spec §2.2 + §4.7: coaches AND admins can view; canProgramForGym
  // covers both (it includes super admins).
  if (!(await canProgramForGym(user.id, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!(await isFlagOn("family_memberships", { userId: user.id, communityId: id }))) {
    return NextResponse.json({ families: [] });
  }

  const families = await listFamiliesByGym(id);
  // Strip notes for coaches who aren't admins (spec §4.7).
  const isAdmin = (await isSuperAdmin(user.id)) || (await canAdminGym(user.id, id));

  // Annotate each dependent with their pending-doc count (PR 2 §5.5).
  // This is N+1 queries but N is small (single-gym family list); fine
  // for v1 — fold into a single roll-up query if it becomes hot.
  const serialized = await Promise.all(
    families.map(async (f) => ({
      accountHolder: f.accountHolder,
      dependents: await Promise.all(
        f.dependents.map(async (d) => {
          const pending = await getPendingDocumentsForMember(
            d.dependent.id,
            id
          );
          return {
            ...d,
            notes: isAdmin ? d.notes : null,
            pendingDocCount: pending.length,
          };
        })
      ),
    }))
  );

  return NextResponse.json({ families: serialized });
}
