// POST /api/family/invites/[token]/decline
//
// Decline a pending family-consent invite. Symmetric to accept.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { familyInvites } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { declineFamilyInvite } from "@/lib/family";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { token } = await params;
  const [invite] = await db
    .select({
      inviteeUserId: familyInvites.inviteeUserId,
      respondedAt: familyInvites.respondedAt,
    })
    .from(familyInvites)
    .where(eq(familyInvites.token, token))
    .limit(1);
  if (!invite) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (invite.inviteeUserId !== user.id) {
    return NextResponse.json(
      { error: "This invite is for a different account" },
      { status: 403 }
    );
  }
  if (invite.respondedAt) {
    return NextResponse.json(
      { error: "Invite was already accepted or declined" },
      { status: 409 }
    );
  }

  await declineFamilyInvite(token);
  return NextResponse.json({ ok: true });
}
