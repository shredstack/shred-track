// ---------------------------------------------------------------------------
// POST /api/me/crossfit-view
//
// Body: { view: "gym" | "personal" }
// Persists the user's CrossFit page view preference. Stored on the user row
// so it survives app reinstalls and syncs across devices — read back via
// GET /api/me/gym-context, written via useSetCrossfitView.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSessionUser } from "@/lib/session";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const view = body?.view;
  if (view !== "gym" && view !== "personal") {
    return NextResponse.json(
      { error: "view must be 'gym' or 'personal'" },
      { status: 400 }
    );
  }

  await db
    .update(users)
    .set({ crossfitView: view, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  return NextResponse.json({ crossfitView: view });
}
