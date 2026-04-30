import { NextResponse } from "next/server";
import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { getSessionUser } from "@/lib/session";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

// POST /api/account/delete
//
// Required by Apple App Store: in-app account deletion. We **anonymize**
// rather than hard-delete because:
//   1. Many user-owned tables don't have ON DELETE CASCADE (e.g.
//      community-published workouts) — hard delete would either fail with
//      FK errors or orphan shared data that other athletes still see.
//   2. Hard delete cascades community workouts a gym admin posted, which
//      surprises the rest of the community.
//
// Anonymization removes all PII the app holds, then closes the auth account
// so the user can't sign back in. Apple has accepted this pattern for years
// (e.g. it's how Spotify, Strava handle deletion). See questions doc for the
// open product question on hard-delete vs. anonymize.

export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.error(
      "[account-delete] SUPABASE_SERVICE_ROLE_KEY is not set; cannot delete auth user.",
    );
    return NextResponse.json(
      {
        error:
          "Account deletion is temporarily unavailable. Please contact shredstacksarah@gmail.com.",
      },
      { status: 500 },
    );
  }

  // 1. Anonymize the user row. Email becomes a unique placeholder so the
  //    `unique` constraint doesn't break and the original address can be
  //    re-registered if the person comes back.
  const anonymizedEmail = `deleted-${user.id}@deleted.shredtrack.local`;
  await db
    .update(users)
    .set({
      email: anonymizedEmail,
      name: "Deleted Athlete",
      gender: null,
      image: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  // 2. Delete the Supabase auth user so they can't sign back in.
  const admin = createSupabaseAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.error("[account-delete] Failed to delete auth user:", error);
    return NextResponse.json(
      {
        error:
          "We removed your data but couldn't fully close your auth session. Please contact shredstacksarah@gmail.com.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
