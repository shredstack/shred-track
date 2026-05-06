import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { recoveryScheduleAssignments } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { getScheduleAccess } from "@/lib/authz/recovery";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; assignmentId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, assignmentId } = await params;

  const access = await getScheduleAccess(user.id, id);
  if (!access.canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const updates: Record<string, unknown> = {};
  if (typeof body.startsOn === "string") updates.startsOn = body.startsOn;
  if (typeof body.endsOn === "string" || body.endsOn === null) updates.endsOn = body.endsOn;
  if (typeof body.durationLabel === "string" || body.durationLabel === null) {
    updates.durationLabel = body.durationLabel;
  }

  const [row] = await db
    .update(recoveryScheduleAssignments)
    .set(updates)
    .where(
      and(
        eq(recoveryScheduleAssignments.id, assignmentId),
        eq(recoveryScheduleAssignments.scheduleId, id)
      )
    )
    .returning();

  return NextResponse.json(row);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; assignmentId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, assignmentId } = await params;

  const access = await getScheduleAccess(user.id, id);
  if (!access.canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await db
    .delete(recoveryScheduleAssignments)
    .where(
      and(
        eq(recoveryScheduleAssignments.id, assignmentId),
        eq(recoveryScheduleAssignments.scheduleId, id)
      )
    );

  return NextResponse.json({ ok: true });
}
