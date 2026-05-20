// /api/family
//
// GET  — list the current user's dependents in a given gym.
// POST — add a dependent. Two branches per spec §3.3:
//   - email matches an existing real ShredTrack user → create a
//     family_invites row + send consent email, do NOT materialize a
//     family_members row until the recipient accepts.
//   - otherwise → create a shadow user + community_memberships + family_members
//     in one transaction.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  communities,
  communityMemberships,
  familyMembers,
  users,
  FAMILY_RELATIONSHIPS,
  type FamilyRelationship,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { isFlagOn } from "@/lib/feature-flags";
import { sendEmail } from "@/lib/email";
import FamilyInviteEmail from "@/emails/family-invite";
import {
  createFamilyInvite,
  createShadowDependent,
  listFamilyForAccountHolder,
} from "@/lib/family";

const APP_URL = "https://shredtrack.shredstack.net";

async function requireFamilyFlag(
  userId: string,
  communityId: string
): Promise<boolean> {
  return await isFlagOn("family_memberships", {
    userId,
    communityId,
  });
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const communityId = url.searchParams.get("communityId");
  if (!communityId) {
    return NextResponse.json(
      { error: "communityId is required" },
      { status: 400 }
    );
  }

  // Caller must be a member of the gym (any role; we don't gate the
  // "see my own family" view by isActive — a deactivated account holder
  // should still be able to see who they had on their plan).
  const [membership] = await db
    .select({ id: communityMemberships.id })
    .from(communityMemberships)
    .where(
      and(
        eq(communityMemberships.communityId, communityId),
        eq(communityMemberships.userId, user.id)
      )
    )
    .limit(1);
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!(await requireFamilyFlag(user.id, communityId))) {
    return NextResponse.json({ dependents: [] });
  }

  const dependents = await listFamilyForAccountHolder(user.id, communityId);
  return NextResponse.json({ dependents });
}

interface AddDependentBody {
  communityId?: string;
  firstName?: string;
  lastName?: string | null;
  dateOfBirth?: string | null;
  gender?: "male" | "female" | "other" | null;
  relationship?: FamilyRelationship;
  email?: string | null;
  hasOwnLogin?: boolean;
  notes?: string | null;
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as AddDependentBody | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const {
    communityId,
    firstName,
    lastName,
    dateOfBirth,
    gender,
    relationship,
    email,
    hasOwnLogin,
    notes,
  } = body;

  if (!communityId) {
    return NextResponse.json(
      { error: "communityId is required" },
      { status: 400 }
    );
  }
  if (!firstName || typeof firstName !== "string" || !firstName.trim()) {
    return NextResponse.json(
      { error: "firstName is required" },
      { status: 400 }
    );
  }
  if (!relationship || !FAMILY_RELATIONSHIPS.includes(relationship)) {
    return NextResponse.json(
      { error: "relationship must be one of " + FAMILY_RELATIONSHIPS.join(", ") },
      { status: 400 }
    );
  }
  if (hasOwnLogin && !email) {
    return NextResponse.json(
      { error: "email is required when hasOwnLogin is true" },
      { status: 400 }
    );
  }

  // Caller must be an active member of the gym (spec §4.2).
  const [membership] = await db
    .select({ isActive: communityMemberships.isActive })
    .from(communityMemberships)
    .where(
      and(
        eq(communityMemberships.communityId, communityId),
        eq(communityMemberships.userId, user.id)
      )
    )
    .limit(1);
  if (!membership || !membership.isActive) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!(await requireFamilyFlag(user.id, communityId))) {
    return NextResponse.json({ error: "Feature not enabled" }, { status: 403 });
  }

  const normalizedEmail = email?.trim().toLowerCase() || null;

  // Branch 1: real user with this email already exists → consent flow.
  if (normalizedEmail) {
    const [existingReal] = await db
      .select({
        id: users.id,
        name: users.name,
        isShadow: users.isShadow,
      })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (existingReal && !existingReal.isShadow) {
      if (existingReal.id === user.id) {
        return NextResponse.json(
          { error: "Cannot add yourself as your own dependent" },
          { status: 400 }
        );
      }

      const { token } = await createFamilyInvite({
        accountHolderUserId: user.id,
        communityId,
        inviteeUserId: existingReal.id,
        relationship,
      });

      const [gym] = await db
        .select({ name: communities.name })
        .from(communities)
        .where(eq(communities.id, communityId))
        .limit(1);

      const link = `${APP_URL}/family/invites/${token}`;
      await sendEmail({
        to: normalizedEmail,
        subject: `${user.name} added you as a family member on ShredTrack`,
        react: FamilyInviteEmail({
          recipientName: existingReal.name,
          accountHolderName: user.name,
          communityName: gym?.name ?? "your gym",
          link,
          kind: "consent",
        }),
      });

      return NextResponse.json(
        {
          status: "consent_invite_sent",
          inviteeUserId: existingReal.id,
        },
        { status: 202 }
      );
    }
  }

  // Branch 2: shadow create (no email, or email is unused / belongs to
  // another shadow that hasn't activated).
  try {
    const created = await createShadowDependent({
      accountHolderUserId: user.id,
      communityId,
      firstName: firstName.trim(),
      lastName: lastName?.trim() || null,
      dateOfBirth: dateOfBirth || null,
      gender: gender ?? null,
      relationship,
      email: normalizedEmail,
      notes: notes?.trim() || null,
    });

    // If the spec says: at add-time, hasOwnLogin starts off; the
    // account holder triggers the activation separately via /invite.
    // We honor the input flag by *not* auto-sending — the caller can
    // POST /api/family/<id>/invite afterward. That's the documented
    // shape (spec §4.5).

    return NextResponse.json({
      status: "shadow_created",
      familyMemberId: created.familyMemberId,
      dependentUserId: created.dependentUserId,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("EMAIL_BELONGS_TO_REAL_USER")) {
      return NextResponse.json(
        { error: "An account already uses that email — they must consent" },
        { status: 409 }
      );
    }
    if (msg.includes("EMAIL_BELONGS_TO_EXISTING_SHADOW")) {
      return NextResponse.json(
        { error: "That email is already in use by another shadow account" },
        { status: 409 }
      );
    }
    throw err;
  }
}

// Force module evaluation of familyMembers so its types stay used in
// IDEs even though all DB reads here go through the lib helper.
void familyMembers;
