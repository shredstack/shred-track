// /api/gym/[id]/classes/schedules
//
// GET: list class_schedules (+ slots) for a gym. Coach/admin only.
// POST: create a class_schedule with optional initial slots.

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { classScheduleSlots, classSchedules } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";
import { materializeScheduleSlotsForCommunity } from "@/lib/classes";

interface SlotPayload {
  rrule: string;
  startTime: string;
  durationMin: number;
  capacity?: number | null;
  coachId?: string | null;
  activeFrom: string;
  activeTo?: string | null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Only active schedules. A "deleted" schedule is soft-deleted
  // (is_active=false) so its past class instances keep their name.
  const schedules = await db
    .select()
    .from(classSchedules)
    .where(
      and(
        eq(classSchedules.communityId, communityId),
        eq(classSchedules.isActive, true)
      )
    )
    .orderBy(asc(classSchedules.name));
  const ids = schedules.map((s) => s.id);
  const slots = ids.length
    ? await db
        .select()
        .from(classScheduleSlots)
        .where(inArray(classScheduleSlots.scheduleId, ids))
    : [];
  return NextResponse.json({
    schedules: schedules.map((s) => ({
      ...s,
      slots: slots.filter((sl) => sl.scheduleId === s.id),
    })),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const defaultCapacity =
    typeof body.defaultCapacity === "number" && body.defaultCapacity > 0
      ? Math.floor(body.defaultCapacity)
      : 20;
  const slotsPayload: SlotPayload[] = Array.isArray(body.slots)
    ? body.slots
    : [];

  const inserted = await db.transaction(async (tx) => {
    const [sched] = await tx
      .insert(classSchedules)
      .values({
        communityId,
        name: body.name.trim(),
        description: body.description ?? null,
        defaultCapacity,
        defaultCoachId: body.defaultCoachId ?? null,
      })
      .returning();
    if (slotsPayload.length) {
      await tx.insert(classScheduleSlots).values(
        slotsPayload.map((s) => ({
          scheduleId: sched.id,
          rrule: s.rrule,
          startTime: s.startTime,
          durationMin: s.durationMin,
          capacity: s.capacity ?? null,
          coachId: s.coachId ?? null,
          activeFrom: s.activeFrom,
          activeTo: s.activeTo ?? null,
        }))
      );
    }
    return sched;
  });

  // Materialize class_instances right away so athletes see them on the
  // schedule without waiting for the next weekly cron. Surface failures —
  // a schedule with no instances is invisible to athletes, so silent
  // failure is the wrong default. The schedule row already committed, so
  // the user can retry via the cron or by re-saving.
  try {
    await materializeScheduleSlotsForCommunity({
      communityId,
      scheduleIds: [inserted.id],
    });
  } catch (err) {
    console.error("materialize-after-schedule-create failed", err);
    return NextResponse.json(
      {
        schedule: inserted,
        warning:
          "Schedule saved but failed to generate class instances. Try editing the schedule to retry.",
      },
      { status: 207 }
    );
  }

  return NextResponse.json(inserted, { status: 201 });
}
