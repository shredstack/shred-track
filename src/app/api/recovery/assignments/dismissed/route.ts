import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  recoveryAssignmentOverrides,
  recoveryScheduleAssignments,
  recoverySchedules,
  communities,
} from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// GET /api/recovery/assignments/dismissed
// Returns the caller's currently-dismissed assignments so they can re-enable
// gym-wide programming they previously hid. Per-user assignments are
// included too — the athlete may have hidden a coach's direct assignment
// and want it back.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select({
      assignmentId: recoveryScheduleAssignments.id,
      scheduleId: recoveryScheduleAssignments.scheduleId,
      scheduleName: recoverySchedules.name,
      communityId: recoveryScheduleAssignments.communityId,
      communityName: communities.name,
      startsOn: recoveryScheduleAssignments.startsOn,
      endsOn: recoveryScheduleAssignments.endsOn,
      durationLabel: recoveryScheduleAssignments.durationLabel,
      isPersonal: recoveryScheduleAssignments.userId,
      overrideId: recoveryAssignmentOverrides.id,
      overrideUpdatedAt: recoveryAssignmentOverrides.updatedAt,
    })
    .from(recoveryAssignmentOverrides)
    .innerJoin(
      recoveryScheduleAssignments,
      eq(recoveryAssignmentOverrides.assignmentId, recoveryScheduleAssignments.id)
    )
    .leftJoin(recoverySchedules, eq(recoveryScheduleAssignments.scheduleId, recoverySchedules.id))
    .leftJoin(communities, eq(recoveryScheduleAssignments.communityId, communities.id))
    .where(
      and(
        eq(recoveryAssignmentOverrides.userId, user.id),
        eq(recoveryAssignmentOverrides.isDismissed, true)
      )
    )
    .orderBy(desc(recoveryAssignmentOverrides.updatedAt));

  return NextResponse.json(
    rows.map((r) => ({
      assignmentId: r.assignmentId,
      scheduleId: r.scheduleId,
      scheduleName: r.scheduleName,
      communityId: r.communityId,
      communityName: r.communityName,
      startsOn: r.startsOn,
      endsOn: r.endsOn,
      durationLabel: r.durationLabel,
      isGymWide: r.communityId !== null,
      dismissedAt: r.overrideUpdatedAt,
    }))
  );
}
