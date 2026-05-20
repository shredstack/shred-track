// GET /api/family/invites/[token]
//
// Public view of a pending family-consent invite. Used by the recipient
// to render the accept/decline page. We don't require authentication
// to read the token's metadata — the token itself is the secret. The
// accept/decline POSTs do require auth.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { communities, familyInvites, users } from "@/db/schema";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const [invite] = await db
    .select({
      id: familyInvites.id,
      relationship: familyInvites.relationship,
      expiresAt: familyInvites.expiresAt,
      respondedAt: familyInvites.respondedAt,
      response: familyInvites.response,
      accountHolderUserId: familyInvites.accountHolderUserId,
      inviteeUserId: familyInvites.inviteeUserId,
      communityId: familyInvites.communityId,
    })
    .from(familyInvites)
    .where(eq(familyInvites.token, token))
    .limit(1);
  if (!invite) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const expired = invite.expiresAt.getTime() < Date.now();

  const [accountHolder] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, invite.accountHolderUserId))
    .limit(1);

  const [community] = await db
    .select({ name: communities.name })
    .from(communities)
    .where(eq(communities.id, invite.communityId))
    .limit(1);

  return NextResponse.json({
    relationship: invite.relationship,
    expiresAt: invite.expiresAt.toISOString(),
    expired,
    responded: !!invite.respondedAt,
    response: invite.response,
    accountHolderName: accountHolder?.name ?? "An account holder",
    communityName: community?.name ?? "the gym",
  });
}
