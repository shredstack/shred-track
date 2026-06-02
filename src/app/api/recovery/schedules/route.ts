import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  recoverySchedules,
  recoveryScheduleSlots,
  recoveryScheduleAssignments,
  communityMemberships,
} from "@/db/schema";
import { and, eq, inArray, or } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { canCreateGymSchedule } from "@/lib/authz/recovery";

// GET — list schedules visible to the caller.
// Returns schedules the user created (personal), gym schedules from gyms
// they're an active member of, and any schedule assigned to them.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const memberships = await db
    .select({ communityId: communityMemberships.communityId })
    .from(communityMemberships)
    .where(
      and(eq(communityMemberships.userId, user.id), eq(communityMemberships.isActive, true))
    );
  const myGyms = memberships.map((m) => m.communityId);

  // Schedule ids assigned directly to this user.
  const myAssignments = await db
    .select({ scheduleId: recoveryScheduleAssignments.scheduleId })
    .from(recoveryScheduleAssignments)
    .where(eq(recoveryScheduleAssignments.userId, user.id));
  const assignedIds = myAssignments.map((a) => a.scheduleId);

  const conditions = [eq(recoverySchedules.createdBy, user.id)];
  if (myGyms.length) conditions.push(inArray(recoverySchedules.communityId, myGyms));
  if (assignedIds.length) conditions.push(inArray(recoverySchedules.id, assignedIds));

  const rows = await db
    .select()
    .from(recoverySchedules)
    .where(or(...conditions)!)
    .orderBy(recoverySchedules.updatedAt);

  return NextResponse.json(rows);
}

// POST — create a schedule.
// Body: { name, kind, rotationDays?, weeklyTarget?, description?, communityId?, slots: [{...}] }
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const kind = body.kind === "frequency_keyed" ? "frequency_keyed" : "day_keyed";
  const rotationDays = kind === "day_keyed" ? Number(body.rotationDays ?? 1) : null;
  const weeklyTarget = kind === "frequency_keyed" ? Number(body.weeklyTarget ?? 1) : null;
  const communityId: string | null = body.communityId ?? null;

  if (!(await canCreateGymSchedule(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const slots = Array.isArray(body.slots) ? body.slots : [];

  // is_active defaults to true server-side, but accept an explicit value too.
  const isActive = typeof body.isActive === "boolean" ? body.isActive : true;
  // null = every day. Validate the array if one is given.
  let activeDaysOfWeek: number[] | null = null;
  if (Array.isArray(body.activeDaysOfWeek)) {
    activeDaysOfWeek = Array.from(
      new Set(
        body.activeDaysOfWeek.filter(
          (d: unknown) => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6
        ) as number[]
      )
    ).sort((a, b) => a - b);
  }

  // "Every N days" recurrence. Only meaningful for day_keyed schedules.
  // Both fields must be set together (DB also enforces this).
  let intervalDays: number | null = null;
  let intervalStartsOn: string | null = null;
  if (
    kind === "day_keyed" &&
    typeof body.intervalDays === "number" &&
    Number.isInteger(body.intervalDays) &&
    body.intervalDays >= 1 &&
    typeof body.intervalStartsOn === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(body.intervalStartsOn)
  ) {
    intervalDays = body.intervalDays;
    intervalStartsOn = body.intervalStartsOn;
    // Interval mode supersedes the day-of-week filter — clear it to keep the
    // data unambiguous (the resolver also ignores activeDaysOfWeek when
    // interval is set, but we don't want to leave stale state lying around).
    activeDaysOfWeek = null;
  }

  const result = await db.transaction(async (tx) => {
    const [schedule] = await tx
      .insert(recoverySchedules)
      .values({
        name,
        kind,
        rotationDays,
        weeklyTarget,
        description: body.description ?? null,
        rotationStrategy: body.rotationStrategy === "calendar" ? "calendar" : "progress",
        communityId,
        createdBy: user.id,
        isActive,
        activeDaysOfWeek,
        intervalDays,
        intervalStartsOn,
      })
      .returning();

    if (slots.length) {
      await tx.insert(recoveryScheduleSlots).values(
        slots.map((s: { dayIndex?: number | null; orderIndex?: number; movementId?: string | null; routineId?: string | null; prescription?: object; notes?: string | null }, i: number) => ({
          scheduleId: schedule.id,
          dayIndex: kind === "day_keyed" ? s.dayIndex ?? null : null,
          orderIndex: typeof s.orderIndex === "number" ? s.orderIndex : i,
          movementId: s.movementId ?? null,
          routineId: s.routineId ?? null,
          prescription: s.prescription ?? {},
          notes: s.notes ?? null,
        }))
      );
    }

    return schedule;
  });

  return NextResponse.json(result, { status: 201 });
}
