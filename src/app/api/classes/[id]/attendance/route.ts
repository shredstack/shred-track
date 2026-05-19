// POST /api/classes/[id]/attendance
//
// Coach/admin marks per-user attendance for a class instance. Body shape:
//   { entries: [{ userId, status: 'attended' | 'no_show' | 'registered' }] }
// Each entry upserts the registration row. Status changes to 'attended'
// fire the committed_club_progress / committed_club_earned notification
// via Inngest.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { classInstances, classRegistrations } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";
import { inngest } from "@/inngest/client";

const VALID = new Set(["registered", "no_show", "attended"]);

interface Entry {
  userId: string;
  status: "registered" | "no_show" | "attended";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: classInstanceId } = await params;
  const [instance] = await db
    .select({
      communityId: classInstances.communityId,
    })
    .from(classInstances)
    .where(eq(classInstances.id, classInstanceId))
    .limit(1);
  if (!instance) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canManageGym(user.id, instance.communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.entries)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const entries: Entry[] = body.entries
    .filter(
      (e: unknown): e is Entry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as Entry).userId === "string" &&
        VALID.has((e as Entry).status)
    );

  const newlyAttended: string[] = [];
  await db.transaction(async (tx) => {
    for (const e of entries) {
      const [existing] = await tx
        .select({
          id: classRegistrations.id,
          status: classRegistrations.status,
        })
        .from(classRegistrations)
        .where(
          and(
            eq(classRegistrations.classInstanceId, classInstanceId),
            eq(classRegistrations.userId, e.userId)
          )
        )
        .limit(1);
      const isAttended = e.status === "attended";
      const wasAttended = existing?.status === "attended";
      if (existing) {
        await tx
          .update(classRegistrations)
          .set({
            status: e.status,
            attendedAt: isAttended ? new Date() : null,
          })
          .where(eq(classRegistrations.id, existing.id));
      } else {
        await tx.insert(classRegistrations).values({
          classInstanceId,
          userId: e.userId,
          status: e.status,
          attendedAt: isAttended ? new Date() : null,
        });
      }
      if (isAttended && !wasAttended) newlyAttended.push(e.userId);
    }
  });

  for (const userId of newlyAttended) {
    try {
      await inngest.send({
        id: `attendance:${classInstanceId}:${userId}`,
        name: "committed-club/attended",
        data: { userId, communityId: instance.communityId, classInstanceId },
      });
    } catch (err) {
      console.error("[attendance] inngest send failed", err);
    }
  }
  return NextResponse.json({ ok: true, newlyAttended: newlyAttended.length });
}
