// /api/me/notification-preferences
//
// GET: returns the caller's preferences map { kind → { inAppEnabled,
// pushEnabled } }. Missing rows default to both true.
// PATCH: upserts one or more preferences.

import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { notificationPreferences } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { NOTIFICATION_KINDS, type NotificationKind } from "@/db/schema";

interface PrefValue {
  inAppEnabled: boolean;
  pushEnabled: boolean;
}

const KIND_SET = new Set<string>(NOTIFICATION_KINDS as readonly string[]);

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, user.id));
  const map: Record<string, PrefValue> = {};
  for (const r of rows) {
    map[r.kind] = {
      inAppEnabled: r.inAppEnabled,
      pushEnabled: r.pushEnabled,
    };
  }
  return NextResponse.json({ preferences: map });
}

export async function PATCH(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const updates = body.preferences as
    | Record<string, Partial<PrefValue>>
    | undefined;
  if (!updates || typeof updates !== "object") {
    return NextResponse.json({ error: "preferences required" }, { status: 400 });
  }

  for (const [kind, val] of Object.entries(updates)) {
    if (!KIND_SET.has(kind)) continue;
    const inAppEnabled = val.inAppEnabled ?? true;
    const pushEnabled = val.pushEnabled ?? true;
    await db
      .insert(notificationPreferences)
      .values({
        userId: user.id,
        kind: kind as NotificationKind,
        inAppEnabled,
        pushEnabled,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [notificationPreferences.userId, notificationPreferences.kind],
        set: { inAppEnabled, pushEnabled, updatedAt: sql`now()` },
      });
  }

  return NextResponse.json({ ok: true });
}
