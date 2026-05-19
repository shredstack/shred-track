// POST   /api/me/push-tokens         — upsert a push token for the caller
// DELETE /api/me/push-tokens?token=… — remove a token (user signed out)
//
// Called by the Capacitor PushNotifications wrapper on app launch and on
// sign-out. The unique (user_id, token) constraint dedupes across launches.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { pushTokens } from "@/db/schema";
import { getSessionUser } from "@/lib/session";

interface RegisterBody {
  token: string;
  platform: "ios" | "android";
  deviceId?: string | null;
  appVersion?: string | null;
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as RegisterBody | null;
  if (!body?.token || (body.platform !== "ios" && body.platform !== "android")) {
    return NextResponse.json(
      { error: "token and platform (ios|android) are required" },
      { status: 400 }
    );
  }

  await db
    .insert(pushTokens)
    .values({
      userId: user.id,
      token: body.token,
      platform: body.platform,
      deviceId: body.deviceId ?? null,
      appVersion: body.appVersion ?? null,
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [pushTokens.userId, pushTokens.token],
      set: {
        platform: body.platform,
        deviceId: body.deviceId ?? null,
        appVersion: body.appVersion ?? null,
        lastSeenAt: new Date(),
      },
    });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  await db
    .delete(pushTokens)
    .where(and(eq(pushTokens.userId, user.id), eq(pushTokens.token, token)));

  return NextResponse.json({ ok: true });
}
