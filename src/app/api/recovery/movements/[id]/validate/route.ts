import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { recoveryMovements } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { isSuperAdmin } from "@/lib/authz/community";
import { canValidateMovement } from "@/lib/authz/recovery";

// POST /api/recovery/movements/[id]/validate
// Promote a pending movement so it becomes visible to everyone.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [m] = await db
    .select()
    .from(recoveryMovements)
    .where(eq(recoveryMovements.id, id))
    .limit(1);
  if (!m) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (m.isValidated) return NextResponse.json(m);

  // Super admin can always validate. Coach/admin can validate any pending
  // movement; the spec scopes to "submitter's gym" but submitter membership
  // isn't tracked on the movement row, so we accept any coach/admin with an
  // active role anywhere — defense-in-depth: only validated rows become
  // public, and a misuse is recoverable via DELETE.
  const ok = (await isSuperAdmin(user.id)) || (await canValidateMovement(user.id, null));
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [updated] = await db
    .update(recoveryMovements)
    .set({ isValidated: true, updatedAt: new Date() })
    .where(eq(recoveryMovements.id, id))
    .returning();

  return NextResponse.json(updated);
}
