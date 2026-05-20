// POST /api/family/invites/[token]/accept
//
// Accept a pending family-consent invite. The recipient must be signed
// in as the invitee_user_id on the invite — we don't auto-attach the
// invite to whoever's logged in.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { familyInvites } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { acceptFamilyInvite } from "@/lib/family";

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
    .select({ inviteeUserId: familyInvites.inviteeUserId })
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

  try {
    const result = await acceptFamilyInvite(token);
    return NextResponse.json({ ok: true, communityId: result.communityId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("INVITE_EXPIRED")) {
      return NextResponse.json({ error: "Invite expired" }, { status: 410 });
    }
    if (msg.includes("INVITE_ALREADY_RESPONDED")) {
      return NextResponse.json(
        { error: "Invite was already accepted or declined" },
        { status: 409 }
      );
    }
    if (msg.includes("INVITE_NOT_FOUND")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw err;
  }
}
