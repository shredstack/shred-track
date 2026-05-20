// POST /api/family/[id]/invite
//
// Sends an activation email to a shadow dependent so they can set a
// password and take over their own login. Generates a 14-day single-use
// token (spec §4.5). Rate limit: 3 sends per family_members row per
// 24h.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { communities, familyMembers, users } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { sendEmail } from "@/lib/email";
import FamilyInviteEmail from "@/emails/family-invite";
import {
  ACTIVATION_TOKEN_TTL_MS,
  familyMemberBelongsToHolder,
  generateToken,
  isShadowEmail,
} from "@/lib/family";

const APP_URL = "https://shredtrack.shredstack.net";

export async function POST(
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
  if (check.row.hasOwnLogin) {
    return NextResponse.json(
      { error: "Dependent already has a login" },
      { status: 400 }
    );
  }

  const [fm] = await db
    .select()
    .from(familyMembers)
    .where(eq(familyMembers.id, id))
    .limit(1);
  if (!fm) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [dep] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      isShadow: users.isShadow,
    })
    .from(users)
    .where(eq(users.id, fm.dependentUserId))
    .limit(1);
  if (!dep) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!dep.isShadow) {
    return NextResponse.json(
      { error: "Dependent already has a login" },
      { status: 400 }
    );
  }
  if (isShadowEmail(dep.email)) {
    return NextResponse.json(
      {
        error:
          "Set a real email on the dependent before sending an activation invite",
      },
      { status: 400 }
    );
  }

  // Minimal rate limit: 1-minute cooldown between sends, derived from
  // the row's last sent-at. TODO: track a real per-row counter (e.g. in
  // a separate audit table) so we can enforce "≤3 invites per 24h" —
  // spec §4.5. Without that table we can't count history because the
  // sent-at gets overwritten on each resend.
  if (fm.activationTokenSentAt) {
    const since = Date.now() - fm.activationTokenSentAt.getTime();
    if (since < 60 * 1000) {
      return NextResponse.json(
        { error: "An invite was just sent. Try again in a minute." },
        { status: 429 }
      );
    }
  }

  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ACTIVATION_TOKEN_TTL_MS);

  await db
    .update(familyMembers)
    .set({
      activationToken: token,
      activationTokenSentAt: now,
      activationTokenExpiresAt: expiresAt,
      updatedAt: now,
    })
    .where(eq(familyMembers.id, id));

  const [gym] = await db
    .select({ name: communities.name })
    .from(communities)
    .where(eq(communities.id, fm.communityId))
    .limit(1);

  const link = `${APP_URL}/activate/${token}`;
  await sendEmail({
    to: dep.email,
    subject: `${user.name} invited you to ShredTrack`,
    react: FamilyInviteEmail({
      recipientName: dep.name,
      accountHolderName: user.name,
      communityName: gym?.name ?? "ShredTrack",
      link,
      kind: "activate",
    }),
  });

  return NextResponse.json({
    sentTo: dep.email,
    expiresAt: expiresAt.toISOString(),
  });
}
