// POST /api/family/activate
//
// Body: { token, password, email? }
//
// Runs the shadow-promotion logic (spec §3.3 step 3):
//   - validate token, dependent is still shadow, token not expired
//   - if a Supabase auth user already exists for the dependent's email:
//       edge case A — merge the shadow into the existing real user, soft-
//       delete the shadow, notify the account holder
//   - otherwise:
//       create a Supabase auth user with `email` + `password`, flip
//       is_shadow=false on the dependent's users row, set
//       family_members.has_own_login=true + activated_at + clear token
//
// The caller does NOT need to be authenticated — possession of the token
// is the credential.

import { NextResponse } from "next/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { communities, familyMembers, users } from "@/db/schema";
import { sendEmail } from "@/lib/email";
import FamilyShadowMergedEmail from "@/emails/family-shadow-merged";
import {
  isShadowEmail,
  mergeShadowIntoUser,
  promoteShadowToReal,
} from "@/lib/family";

interface ActivateBody {
  token?: string;
  password?: string;
  email?: string;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as ActivateBody | null;
  if (!body?.token || !body?.password) {
    return NextResponse.json(
      { error: "token and password are required" },
      { status: 400 }
    );
  }
  if (body.password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    );
  }

  const [fm] = await db
    .select()
    .from(familyMembers)
    .where(eq(familyMembers.activationToken, body.token))
    .limit(1);
  if (!fm) {
    return NextResponse.json({ error: "Invalid token" }, { status: 404 });
  }
  if (fm.activatedAt) {
    return NextResponse.json(
      { error: "Already activated" },
      { status: 409 }
    );
  }
  if (
    !fm.activationTokenExpiresAt ||
    fm.activationTokenExpiresAt.getTime() < Date.now()
  ) {
    return NextResponse.json({ error: "Token expired" }, { status: 410 });
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
    return NextResponse.json({ error: "Dependent not found" }, { status: 404 });
  }
  if (!dep.isShadow) {
    // Token is for an already-real user; nothing to promote. Likely the
    // shadow was previously merged.
    return NextResponse.json({ error: "Already activated" }, { status: 409 });
  }

  // Determine which email the auth user should use. Prefer the form
  // input, fall back to the dependent's stored email (which the account
  // holder previously set on this row).
  const proposedEmail = (body.email || dep.email).trim().toLowerCase();
  if (!proposedEmail || isShadowEmail(proposedEmail)) {
    return NextResponse.json(
      { error: "A real email is required to activate" },
      { status: 400 }
    );
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json(
      { error: "Activation unavailable" },
      { status: 500 }
    );
  }
  const supabaseAdmin = createSupabaseAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  // Edge case A: is there already a Supabase auth user with this email?
  // (Implied if there's a non-shadow users row.)
  const [existingReal] = await db
    .select({ id: users.id, isShadow: users.isShadow })
    .from(users)
    .where(eq(users.email, proposedEmail))
    .limit(1);

  if (existingReal && existingReal.id !== dep.id && !existingReal.isShadow) {
    // Merge shadow into the existing real account. We don't create a
    // new auth user; we just reassign references. The recipient must
    // sign in with their existing credentials separately.
    //
    // Run the merge + activation update in a single transaction so a
    // crash between them can't leave the family link pointing at a
    // soft-deleted shadow with has_own_login=false.
    await db.transaction(async (tx) => {
      await mergeShadowIntoUser(dep.id, existingReal.id, tx);

      // Mark this family_members row as activated under the real id.
      await tx
        .update(familyMembers)
        .set({
          dependentUserId: existingReal.id,
          hasOwnLogin: true,
          activatedAt: new Date(),
          activationToken: null,
          activationTokenSentAt: null,
          activationTokenExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(familyMembers.id, fm.id));
    });

    // Notify the account holder (spec §9.3).
    const [holder] = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, fm.accountHolderUserId))
      .limit(1);
    const [gym] = await db
      .select({ name: communities.name })
      .from(communities)
      .where(eq(communities.id, fm.communityId))
      .limit(1);
    if (holder && !isShadowEmail(holder.email)) {
      // Fire-and-forget; failure here shouldn't undo the merge.
      void sendEmail({
        to: holder.email,
        subject: "Family link kept intact",
        react: FamilyShadowMergedEmail({
          accountHolderName: holder.name,
          dependentName: dep.name || "Your dependent",
          communityName: gym?.name ?? "your gym",
        }),
      });
    }

    return NextResponse.json({ status: "merged" });
  }

  // Standard branch: create a fresh Supabase auth user keyed to the
  // dependent's users.id. Supabase admin API doesn't let us preset the
  // auth user's id, so we create the auth user first, then patch the
  // existing users.id reference. Approach: create auth user (which
  // creates a new auth.users row with its own UUID), then swap the
  // shadow users row's id to match? — Drizzle/Postgres won't allow id
  // updates due to FKs.
  //
  // Easier: create the auth user, then update the dependent's
  // existing users row to set is_shadow=false; the dependent's
  // db users.id stays the same and the auth.users id is separate.
  // Session lookup uses email → auth user, then we map auth user
  // email → public.users row. That mapping is via email today (see
  // getSessionUser); for users created through normal signup we
  // currently match on the auth user's id == public.users id.
  //
  // To keep that invariant, we explicitly provide the user_id when
  // creating the auth user via the admin API's `user_metadata` is not
  // sufficient — but `admin.createUser({ user_id: dep.id, … })` IS
  // supported (Supabase introduced this in 2024). We rely on it.
  const { error: createErr } = await supabaseAdmin.auth.admin.createUser({
    id: dep.id,
    email: proposedEmail,
    password: body.password,
    email_confirm: true,
    user_metadata: { name: (await getDependentName(dep.id)) ?? proposedEmail },
  } as Parameters<typeof supabaseAdmin.auth.admin.createUser>[0]);

  if (createErr) {
    return NextResponse.json(
      { error: `Failed to create login: ${createErr.message}` },
      { status: 500 }
    );
  }

  await promoteShadowToReal(dep.id, proposedEmail);

  return NextResponse.json({ status: "activated", email: proposedEmail });
}

async function getDependentName(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.name ?? null;
}
