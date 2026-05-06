import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  recoverySchedules,
  recoveryScheduleAssignments,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { getScheduleAccess, isActiveMember } from "@/lib/authz/recovery";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const access = await getScheduleAccess(user.id, id);
  if (!access.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!access.canRead) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = await db
    .select()
    .from(recoveryScheduleAssignments)
    .where(eq(recoveryScheduleAssignments.scheduleId, id))
    .orderBy(recoveryScheduleAssignments.createdAt);

  return NextResponse.json(rows);
}

// POST — body: { userId? | communityId?, startsOn, endsOn?, durationLabel? }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [schedule] = await db
    .select()
    .from(recoverySchedules)
    .where(eq(recoverySchedules.id, id))
    .limit(1);
  if (!schedule) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Only coaches/admins of the schedule's gym can assign.
  const access = await getScheduleAccess(user.id, id);
  if (!access.canEdit || !access.isGymScoped) {
    return NextResponse.json({ error: "Only gym schedules can be assigned" }, { status: 403 });
  }

  const body = await req.json();
  const userId: string | null = body.userId ?? null;
  const communityId: string | null = body.communityId ?? null;
  if ((userId && communityId) || (!userId && !communityId)) {
    return NextResponse.json({ error: "Provide exactly one of userId or communityId" }, { status: 400 });
  }
  if (!body.startsOn) {
    return NextResponse.json({ error: "startsOn required" }, { status: 400 });
  }

  // The target gym must match the schedule's gym.
  if (communityId && communityId !== schedule.communityId) {
    return NextResponse.json({ error: "communityId must match the schedule's gym" }, { status: 400 });
  }
  if (userId) {
    // The target user must be an active member of the schedule's gym.
    const ok = await isActiveMember(userId, schedule.communityId!);
    if (!ok) return NextResponse.json({ error: "User is not an active member of this gym" }, { status: 400 });
  }

  const [row] = await db
    .insert(recoveryScheduleAssignments)
    .values({
      scheduleId: id,
      userId,
      communityId: communityId ?? (userId ? null : schedule.communityId),
      startsOn: body.startsOn,
      endsOn: body.endsOn ?? null,
      durationLabel: body.durationLabel ?? null,
      assignedBy: user.id,
    })
    .returning();

  return NextResponse.json(row, { status: 201 });
}
