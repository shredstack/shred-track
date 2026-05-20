import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { communityCaloriePreferences } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { canAdminGym, canViewGym } from "@/lib/authz/community";

// Default surface — also rendered when no row exists yet so the UI doesn't
// have to special-case missing prefs.
const DEFAULT_PREFS = {
  epocDefaultEnabled: true,
  epocMultiplier: 1.10,
};

// GET /api/communities/[id]/calorie-preferences
//
// Members can read so the personal EPOC toggle can show "your gym
// recommends [On/Off, +10%]". Admins use the same payload to edit.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await canViewGym(user.id, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const [row] = await db
    .select()
    .from(communityCaloriePreferences)
    .where(eq(communityCaloriePreferences.communityId, id))
    .limit(1);
  if (!row) return NextResponse.json(DEFAULT_PREFS);
  return NextResponse.json({
    epocDefaultEnabled: row.epocDefaultEnabled,
    epocMultiplier: Number(row.epocMultiplier),
  });
}

// PUT /api/communities/[id]/calorie-preferences
//
// Body: { epocDefaultEnabled?: boolean, epocMultiplier?: number (1.0–1.20) }
// Admin only. Idempotent — upserts by community id.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await canAdminGym(user.id, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));

  const update: { epocDefaultEnabled?: boolean; epocMultiplier?: string } = {};
  if ("epocDefaultEnabled" in body) {
    if (typeof body.epocDefaultEnabled !== "boolean") {
      return NextResponse.json(
        { error: "Invalid epocDefaultEnabled" },
        { status: 400 }
      );
    }
    update.epocDefaultEnabled = body.epocDefaultEnabled;
  }
  if ("epocMultiplier" in body) {
    const n = Number(body.epocMultiplier);
    if (!Number.isFinite(n) || n < 1.0 || n > 1.2) {
      return NextResponse.json(
        { error: "epocMultiplier must be between 1.0 and 1.20" },
        { status: 400 }
      );
    }
    update.epocMultiplier = n.toFixed(2);
  }

  const [row] = await db
    .insert(communityCaloriePreferences)
    .values({
      communityId: id,
      epocDefaultEnabled: update.epocDefaultEnabled ?? DEFAULT_PREFS.epocDefaultEnabled,
      epocMultiplier: update.epocMultiplier ?? DEFAULT_PREFS.epocMultiplier.toFixed(2),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: communityCaloriePreferences.communityId,
      set: { ...update, updatedAt: new Date() },
    })
    .returning();

  return NextResponse.json({
    epocDefaultEnabled: row.epocDefaultEnabled,
    epocMultiplier: Number(row.epocMultiplier),
  });
}
