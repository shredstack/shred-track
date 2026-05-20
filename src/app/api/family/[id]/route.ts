// /api/family/[id]
//
// PATCH  — edit a dependent's profile fields (name, DOB, gender,
//          relationship, email, notes). For shadow dependents the email
//          updates the users.email row directly; for real-login
//          dependents email change is rejected (spec §4.3).
// DELETE — end the gym relationship (spec §4.4). Always deactivates the
//          dependent's community_memberships row and drops the
//          family_members link.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { familyMembers, users, FAMILY_RELATIONSHIPS } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import {
  familyMemberBelongsToHolder,
  isShadowEmail,
  removeDependent,
} from "@/lib/family";

interface PatchBody {
  firstName?: string;
  lastName?: string | null;
  dateOfBirth?: string | null;
  gender?: "male" | "female" | "other" | null;
  relationship?: string;
  email?: string | null;
  notes?: string | null;
}

export async function PATCH(
  req: Request,
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
  const { dependentUserId, hasOwnLogin } = check.row;

  const body = (await req.json().catch(() => null)) as PatchBody | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Build the users-table update set (name, dob, gender, email).
  const userUpdates: Record<string, unknown> = {};
  if (body.firstName !== undefined) {
    const first = body.firstName?.trim();
    if (!first) {
      return NextResponse.json(
        { error: "firstName cannot be empty" },
        { status: 400 }
      );
    }
    const last = body.lastName?.trim() || "";
    userUpdates.name = [first, last].filter(Boolean).join(" ");
  }
  if (body.dateOfBirth !== undefined) {
    userUpdates.dateOfBirth = body.dateOfBirth || null;
  }
  if (body.gender !== undefined) {
    userUpdates.gender = body.gender || null;
  }
  if (body.email !== undefined) {
    if (hasOwnLogin) {
      return NextResponse.json(
        {
          error:
            "Ask the dependent to update their email from their own profile",
        },
        { status: 403 }
      );
    }
    const newEmail = body.email?.trim().toLowerCase() || null;
    if (newEmail) {
      // Refuse if the email is taken by a different non-shadow user.
      const [other] = await db
        .select({ id: users.id, isShadow: users.isShadow })
        .from(users)
        .where(eq(users.email, newEmail))
        .limit(1);
      if (other && other.id !== dependentUserId && !other.isShadow) {
        return NextResponse.json(
          { error: "Email is already in use" },
          { status: 409 }
        );
      }
      userUpdates.email = newEmail;
    } else {
      // Setting email back to null → restore a synthetic shadow email so
      // the unique constraint stays satisfied.
      const [u] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, dependentUserId))
        .limit(1);
      if (u && !isShadowEmail(u.email)) {
        // We need a fresh synthetic; import the helper from family.ts.
        const { generateShadowEmail } = await import("@/lib/family");
        userUpdates.email = generateShadowEmail();
      }
    }
  }
  if (Object.keys(userUpdates).length > 0) {
    userUpdates.updatedAt = new Date();
    await db.update(users).set(userUpdates).where(eq(users.id, dependentUserId));
  }

  // family_members updates (relationship, notes).
  const fmUpdates: Record<string, unknown> = {};
  if (body.relationship !== undefined) {
    if (
      !FAMILY_RELATIONSHIPS.includes(
        body.relationship as (typeof FAMILY_RELATIONSHIPS)[number]
      )
    ) {
      return NextResponse.json(
        { error: "Invalid relationship" },
        { status: 400 }
      );
    }
    fmUpdates.relationship = body.relationship;
  }
  if (body.notes !== undefined) {
    fmUpdates.notes = body.notes?.trim() || null;
  }
  if (Object.keys(fmUpdates).length > 0) {
    fmUpdates.updatedAt = new Date();
    await db.update(familyMembers).set(fmUpdates).where(eq(familyMembers.id, id));
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  try {
    await removeDependent({ familyMemberId: id, accountHolderUserId: user.id });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("NOT_FOUND")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (msg.includes("FORBIDDEN")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw err;
  }
}
