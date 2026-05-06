import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { recoveryAssignmentOverrides, recoveryScheduleAssignments } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { isActiveMember } from "@/lib/authz/recovery";

// PUT — athlete sets their own start/end/dismissal on an assignment.
// Body: { startsOn?, endsOn?, isDismissed? }
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [a] = await db
    .select()
    .from(recoveryScheduleAssignments)
    .where(eq(recoveryScheduleAssignments.id, id))
    .limit(1);
  if (!a) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // The caller must be the targeted user (direct assignment) OR an active
  // member of the gym (gym-wide assignment).
  let allowed = false;
  if (a.userId === user.id) allowed = true;
  else if (a.communityId) allowed = await isActiveMember(user.id, a.communityId);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const startsOn = "startsOn" in body ? body.startsOn ?? null : undefined;
  const endsOn = "endsOn" in body ? body.endsOn ?? null : undefined;
  const isDismissed = typeof body.isDismissed === "boolean" ? body.isDismissed : undefined;

  const [existing] = await db
    .select()
    .from(recoveryAssignmentOverrides)
    .where(
      and(
        eq(recoveryAssignmentOverrides.assignmentId, id),
        eq(recoveryAssignmentOverrides.userId, user.id)
      )
    )
    .limit(1);

  if (existing) {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (startsOn !== undefined) updates.startsOn = startsOn;
    if (endsOn !== undefined) updates.endsOn = endsOn;
    if (isDismissed !== undefined) updates.isDismissed = isDismissed;
    const [updated] = await db
      .update(recoveryAssignmentOverrides)
      .set(updates)
      .where(eq(recoveryAssignmentOverrides.id, existing.id))
      .returning();
    return NextResponse.json(updated);
  }

  const [inserted] = await db
    .insert(recoveryAssignmentOverrides)
    .values({
      assignmentId: id,
      userId: user.id,
      startsOn: startsOn ?? null,
      endsOn: endsOn ?? null,
      isDismissed: isDismissed ?? false,
    })
    .returning();
  return NextResponse.json(inserted, { status: 201 });
}
