// /api/gym/[id]/classes/schedules/[scheduleId]
//
// PATCH:  edit a schedule. Schedule-level fields (name, description, default
//         capacity, default coach) propagate to future, non-overridden class
//         instances. The recurrence slot (days, start time, duration, and the
//         "active from" date) is editable too — when it changes, upcoming
//         classes are regenerated: empty ones are deleted, ones with sign-ups
//         are cancelled (members notified), then fresh instances materialize.
// DELETE: archive a schedule (smart delete). Upcoming classes with no
//         active registrations are hard-deleted; ones with registrations
//         are cancelled and registered members are notified. The schedule
//         row is soft-deleted (is_active=false) so past classes keep their
//         name for attendance history.

import { NextRequest, NextResponse } from "next/server";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  classInstances,
  classRegistrations,
  classScheduleSlots,
  classSchedules,
  communityMemberships,
  notifications,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";
import { materializeScheduleSlotsForCommunity } from "@/lib/classes";
import { inngest } from "@/inngest/client";

async function loadSchedule(scheduleId: string, communityId: string) {
  const [sched] = await db
    .select()
    .from(classSchedules)
    .where(
      and(
        eq(classSchedules.id, scheduleId),
        eq(classSchedules.communityId, communityId)
      )
    )
    .limit(1);
  return sched ?? null;
}

/** Verify a user is an active coach/admin of the gym (for coach assignment). */
async function isGymCoach(userId: string, communityId: string): Promise<boolean> {
  const [member] = await db
    .select({
      isCoach: communityMemberships.isCoach,
      isAdmin: communityMemberships.isAdmin,
    })
    .from(communityMemberships)
    .where(
      and(
        eq(communityMemberships.communityId, communityId),
        eq(communityMemberships.userId, userId),
        eq(communityMemberships.isActive, true)
      )
    )
    .limit(1);
  return !!member && (member.isCoach || member.isAdmin);
}

/** Fan out class-cancelled push notifications, skipping the actor. */
async function notifyCancelled(
  targets: Array<{ userId: string; classInstanceId: string }>,
  actorId: string,
  communityId: string
) {
  const rows = targets
    .filter((t) => t.userId !== actorId)
    .map((t) => ({
      recipientId: t.userId,
      actorId,
      kind: "class_cancelled",
      communityId,
      classInstanceId: t.classInstanceId,
    }));
  if (!rows.length) return;
  const inserted = await db
    .insert(notifications)
    .values(rows)
    .returning({ id: notifications.id });
  for (const n of inserted) {
    try {
      await inngest.send({
        id: `dispatch:${n.id}`,
        name: "notifications/created",
        data: { notificationId: n.id },
      });
    } catch (err) {
      console.error("[schedule] dispatch send failed", err);
    }
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; scheduleId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId, scheduleId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const sched = await loadSchedule(scheduleId, communityId);
  if (!sched) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const updates: Partial<typeof classSchedules.$inferInsert> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json(
        { error: "name cannot be empty" },
        { status: 400 }
      );
    }
    updates.name = body.name.trim();
  }
  if (body.description !== undefined) {
    updates.description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;
  }
  let newCapacity: number | undefined;
  if (body.defaultCapacity !== undefined) {
    if (typeof body.defaultCapacity !== "number" || body.defaultCapacity <= 0) {
      return NextResponse.json(
        { error: "defaultCapacity must be a positive number" },
        { status: 400 }
      );
    }
    newCapacity = Math.floor(body.defaultCapacity);
    updates.defaultCapacity = newCapacity;
  }
  let coachProvided = false;
  let newCoachId: string | null = null;
  if (body.defaultCoachId !== undefined) {
    newCoachId = body.defaultCoachId;
    if (newCoachId !== null && typeof newCoachId !== "string") {
      return NextResponse.json(
        { error: "defaultCoachId must be a string or null" },
        { status: 400 }
      );
    }
    if (newCoachId && !(await isGymCoach(newCoachId, communityId))) {
      return NextResponse.json(
        { error: "Coach not in this gym" },
        { status: 400 }
      );
    }
    coachProvided = true;
    updates.defaultCoachId = newCoachId;
  }

  // Optional recurrence-slot edit. The schedule UI manages a single slot per
  // schedule: days of week (rrule), start time, duration, and "active from".
  let slotUpdate: {
    id: string;
    rrule: string;
    startTime: string;
    durationMin: number;
    activeFrom: string;
  } | null = null;
  if (body.slot !== undefined && body.slot !== null) {
    const s = body.slot;
    if (typeof s !== "object" || typeof s.id !== "string") {
      return NextResponse.json(
        { error: "slot.id is required" },
        { status: 400 }
      );
    }
    if (typeof s.rrule !== "string" || !/BYDAY=[A-Z,]+/.test(s.rrule)) {
      return NextResponse.json(
        { error: "slot.rrule must include at least one day" },
        { status: 400 }
      );
    }
    if (
      typeof s.startTime !== "string" ||
      !/^\d{2}:\d{2}(:\d{2})?$/.test(s.startTime)
    ) {
      return NextResponse.json(
        { error: "slot.startTime must be HH:MM" },
        { status: 400 }
      );
    }
    if (typeof s.durationMin !== "number" || s.durationMin <= 0) {
      return NextResponse.json(
        { error: "slot.durationMin must be a positive number" },
        { status: 400 }
      );
    }
    if (
      typeof s.activeFrom !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(s.activeFrom)
    ) {
      return NextResponse.json(
        { error: "slot.activeFrom must be YYYY-MM-DD" },
        { status: 400 }
      );
    }
    slotUpdate = {
      id: s.id,
      rrule: s.rrule.startsWith("RRULE:") ? s.rrule.slice(6) : s.rrule,
      startTime: s.startTime.length === 5 ? `${s.startTime}:00` : s.startTime,
      durationMin: Math.floor(s.durationMin),
      activeFrom: s.activeFrom,
    };
  }

  if (Object.keys(updates).length === 0 && !slotUpdate) {
    return NextResponse.json({ error: "No updates" }, { status: 400 });
  }
  updates.updatedAt = new Date();

  // Load the slot being edited to confirm it belongs to this schedule and to
  // detect whether the recurrence actually changed — only a real change is
  // worth the (destructive) regeneration of upcoming class instances.
  let existingSlot: typeof classScheduleSlots.$inferSelect | null = null;
  if (slotUpdate) {
    const [row] = await db
      .select()
      .from(classScheduleSlots)
      .where(
        and(
          eq(classScheduleSlots.id, slotUpdate.id),
          eq(classScheduleSlots.scheduleId, scheduleId)
        )
      )
      .limit(1);
    if (!row) {
      return NextResponse.json(
        { error: "Slot not found on this schedule" },
        { status: 404 }
      );
    }
    existingSlot = row;
  }
  const recurrenceChanged =
    !!slotUpdate &&
    !!existingSlot &&
    (existingSlot.rrule !== slotUpdate.rrule ||
      existingSlot.startTime !== slotUpdate.startTime ||
      existingSlot.durationMin !== slotUpdate.durationMin ||
      String(existingSlot.activeFrom) !== slotUpdate.activeFrom);

  const now = new Date();
  let notifyTargets: Array<{ userId: string; classInstanceId: string }> = [];
  await db.transaction(async (tx) => {
    await tx
      .update(classSchedules)
      .set(updates)
      .where(eq(classSchedules.id, scheduleId));

    if (slotUpdate) {
      await tx
        .update(classScheduleSlots)
        .set({
          rrule: slotUpdate.rrule,
          startTime: slotUpdate.startTime,
          durationMin: slotUpdate.durationMin,
          activeFrom: slotUpdate.activeFrom,
        })
        .where(eq(classScheduleSlots.id, slotUpdate.id));
    }

    // Propagate the new default coach to future, non-overridden instances.
    // "Non-overridden" = the instance still carries the *old* default coach
    // and came from a slot with no coach of its own. Per-date edits on the
    // Classes screen changed coach_id away from the old default, so they are
    // skipped automatically.
    // Skipped when the recurrence is changing — the regeneration below
    // rebuilds every future instance with the current coach/capacity anyway.
    if (coachProvided && !recurrenceChanged) {
      const openSlots = await tx
        .select({ id: classScheduleSlots.id })
        .from(classScheduleSlots)
        .where(
          and(
            eq(classScheduleSlots.scheduleId, scheduleId),
            isNull(classScheduleSlots.coachId)
          )
        );
      const slotIds = openSlots.map((s) => s.id);
      if (slotIds.length) {
        await tx
          .update(classInstances)
          .set({ coachId: newCoachId })
          .where(
            and(
              eq(classInstances.scheduleId, scheduleId),
              inArray(classInstances.slotId, slotIds),
              gt(classInstances.startAt, now),
              eq(classInstances.status, "scheduled"),
              sched.defaultCoachId === null
                ? isNull(classInstances.coachId)
                : eq(classInstances.coachId, sched.defaultCoachId)
            )
          );
      }
    }

    // Same idea for capacity: only future instances still on the old default
    // capacity, from slots without their own capacity override.
    if (newCapacity !== undefined && !recurrenceChanged) {
      const openSlots = await tx
        .select({ id: classScheduleSlots.id })
        .from(classScheduleSlots)
        .where(
          and(
            eq(classScheduleSlots.scheduleId, scheduleId),
            isNull(classScheduleSlots.capacity)
          )
        );
      const slotIds = openSlots.map((s) => s.id);
      if (slotIds.length) {
        await tx
          .update(classInstances)
          .set({ capacity: newCapacity })
          .where(
            and(
              eq(classInstances.scheduleId, scheduleId),
              inArray(classInstances.slotId, slotIds),
              gt(classInstances.startAt, now),
              eq(classInstances.status, "scheduled"),
              eq(classInstances.capacity, sched.defaultCapacity)
            )
          );
      }
    }

    // Recurrence changed: every future class this slot produced is now at the
    // wrong day/time. Delete the empty ones and cancel the ones members
    // signed up for (detaching them from the slot so the re-materialize below
    // can recreate a fresh class at the same time without tripping the
    // (slot_id, start_at) unique index). Members are notified after commit.
    if (recurrenceChanged && slotUpdate) {
      const future = await tx
        .select({ id: classInstances.id })
        .from(classInstances)
        .where(
          and(
            eq(classInstances.slotId, slotUpdate.id),
            gt(classInstances.startAt, now),
            eq(classInstances.status, "scheduled")
          )
        );
      const futureIds = future.map((f) => f.id);
      if (futureIds.length) {
        const activeRegs = await tx
          .select({
            userId: classRegistrations.userId,
            classInstanceId: classRegistrations.classInstanceId,
          })
          .from(classRegistrations)
          .where(
            and(
              inArray(classRegistrations.classInstanceId, futureIds),
              eq(classRegistrations.status, "registered")
            )
          );
        notifyTargets = activeRegs;
        const withRegs = new Set(activeRegs.map((r) => r.classInstanceId));
        const cancelIds = futureIds.filter((id) => withRegs.has(id));
        const deleteIds = futureIds.filter((id) => !withRegs.has(id));
        if (cancelIds.length) {
          await tx
            .update(classInstances)
            .set({
              status: "cancelled",
              cancellationReason: "Class schedule changed",
              slotId: null,
            })
            .where(inArray(classInstances.id, cancelIds));
        }
        if (deleteIds.length) {
          await tx
            .delete(classInstances)
            .where(inArray(classInstances.id, deleteIds));
        }
      }
    }
  });

  // Re-materialize after the destructive part commits so members immediately
  // see the class at its new day/time. Notifications go out last, mirroring
  // the DELETE handler.
  let warning: string | undefined;
  if (recurrenceChanged) {
    try {
      await materializeScheduleSlotsForCommunity({
        communityId,
        scheduleIds: [scheduleId],
      });
    } catch (err) {
      console.error("[schedule] re-materialize after slot edit failed", err);
      warning =
        "Schedule saved, but regenerating upcoming classes failed. They'll be rebuilt on the next sync.";
    }
    await notifyCancelled(notifyTargets, user.id, communityId);
  }

  return NextResponse.json(warning ? { ok: true, warning } : { ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; scheduleId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId, scheduleId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const sched = await loadSchedule(scheduleId, communityId);
  if (!sched) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const now = new Date();
  const future = await db
    .select({ id: classInstances.id })
    .from(classInstances)
    .where(
      and(
        eq(classInstances.scheduleId, scheduleId),
        gt(classInstances.startAt, now),
        eq(classInstances.status, "scheduled")
      )
    );
  const futureIds = future.map((f) => f.id);

  // Split upcoming classes: those with active registrations get cancelled
  // (members are notified), the rest are deleted outright.
  let cancelIds: string[] = [];
  let deleteIds: string[] = [];
  let notifyTargets: Array<{ userId: string; classInstanceId: string }> = [];
  if (futureIds.length) {
    const activeRegs = await db
      .select({
        userId: classRegistrations.userId,
        classInstanceId: classRegistrations.classInstanceId,
      })
      .from(classRegistrations)
      .where(
        and(
          inArray(classRegistrations.classInstanceId, futureIds),
          eq(classRegistrations.status, "registered")
        )
      );
    notifyTargets = activeRegs;
    const withRegs = new Set(activeRegs.map((r) => r.classInstanceId));
    cancelIds = futureIds.filter((id) => withRegs.has(id));
    deleteIds = futureIds.filter((id) => !withRegs.has(id));
  }

  await db.transaction(async (tx) => {
    if (cancelIds.length) {
      await tx
        .update(classInstances)
        .set({ status: "cancelled", cancellationReason: "Schedule removed" })
        .where(inArray(classInstances.id, cancelIds));
    }
    if (deleteIds.length) {
      await tx
        .delete(classInstances)
        .where(inArray(classInstances.id, deleteIds));
    }
    // Soft-delete: keep the row so past instances resolve their class name.
    await tx
      .update(classSchedules)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(classSchedules.id, scheduleId));
  });

  await notifyCancelled(notifyTargets, user.id, communityId);

  return NextResponse.json({
    ok: true,
    cancelled: cancelIds.length,
    deleted: deleteIds.length,
  });
}
