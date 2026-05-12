import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { getSessionUser } from "@/lib/session";

// PATCH /api/notifications/read-all — mark every unread notification as read
// for the calling user.
export async function PATCH() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.recipientId, user.id),
        isNull(notifications.readAt)
      )
    );
  return new NextResponse(null, { status: 204 });
}
