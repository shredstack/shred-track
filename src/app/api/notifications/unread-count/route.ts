import { NextResponse } from "next/server";
import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { getSessionUser } from "@/lib/session";

// GET /api/notifications/unread-count
//
// Polled by the header bell badge every 60s when the app is foregrounded.
// Uses the partial index `notifications_recipient_unread_idx`.
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [row] = await db
    .select({ value: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientId, user.id),
        isNull(notifications.readAt)
      )
    );
  return NextResponse.json({ count: row?.value ?? 0 });
}
