// GET /api/family/activate/[token]
//
// Look up a shadow-activation token without consuming it. Used by the
// /activate/[token] page to render dependent info + the password form.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { communities, familyMembers, users } from "@/db/schema";
import { isShadowEmail } from "@/lib/family";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const [fm] = await db
    .select({
      id: familyMembers.id,
      communityId: familyMembers.communityId,
      accountHolderUserId: familyMembers.accountHolderUserId,
      dependentUserId: familyMembers.dependentUserId,
      hasOwnLogin: familyMembers.hasOwnLogin,
      activatedAt: familyMembers.activatedAt,
      expiresAt: familyMembers.activationTokenExpiresAt,
    })
    .from(familyMembers)
    .where(eq(familyMembers.activationToken, token))
    .limit(1);

  if (!fm) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (fm.activatedAt) {
    return NextResponse.json({ status: "already_activated" });
  }
  if (!fm.expiresAt || fm.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ status: "expired" }, { status: 410 });
  }

  const [dep] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, fm.dependentUserId))
    .limit(1);
  const [holder] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, fm.accountHolderUserId))
    .limit(1);
  const [gym] = await db
    .select({ name: communities.name })
    .from(communities)
    .where(eq(communities.id, fm.communityId))
    .limit(1);

  if (!dep) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    status: "valid",
    name: dep.name,
    // Only surface the email if it's a real one. Synthetic shadow
    // addresses leak nothing useful and should not be shown.
    email: isShadowEmail(dep.email) ? null : dep.email,
    accountHolderName: holder?.name ?? "Your account holder",
    communityName: gym?.name ?? "ShredTrack",
  });
}
