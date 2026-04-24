// ---------------------------------------------------------------------------
// DELETE /api/admin/hyrox/vip/[userId]
//
// Revokes a user's VIP grant. Soft-delete: sets active=false so the ledger
// of previously-consumed VIP generations stays intact for audit.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { revokeVipGrant } from "@/lib/plan-credits";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { userId } = await params;
  await revokeVipGrant(userId);
  return NextResponse.json({ ok: true });
}
