// ---------------------------------------------------------------------------
// DELETE /api/admin/users/vip/[userId]
//
// Revokes the VIP flag on a user. Pure boolean toggle — no audit trail beyond
// users.updated_at. If we later need an audit log of grants/revocations, that
// would warrant a dedicated table.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getAdminUser } from "@/lib/admin";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { userId } = await params;

  const [updated] = await db
    .update(users)
    .set({ isVip: false, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ id: users.id });

  if (!updated) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
