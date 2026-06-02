// Resolves "what's the user's recovery plan today?" — used by the today view
// and the session-start endpoint to snapshot a prescription.
//
// Two entry points:
//   resolveToday      — returns at most one schedule (used by start-session
//                       POST when a specific scheduleId is requested).
//   resolveTodayList  — returns every schedule that should display on the
//                       given date. Personal schedules are filtered by their
//                       per-schedule isActive + activeDaysOfWeek settings,
//                       so a user can keep multiple schedules and pick which
//                       ones surface on which days.

import { db } from "@/db";
import {
  recoverySchedules,
  recoveryScheduleSlots,
  recoveryScheduleAssignments,
  recoveryAssignmentOverrides,
  recoverySessions,
  recoveryRoutines,
  recoveryRoutineMovements,
  recoveryMovements,
  users,
} from "@/db/schema";
import { and, eq, desc, lte, gte, isNull, inArray } from "drizzle-orm";

export type RecoveryTodayMode = "personal" | "gym";

export interface RecoveryTodaySlot {
  slotId: string;
  dayIndex: number | null;
  orderIndex: number;
  movementId: string | null;
  movementName: string | null;
  isPerSide: boolean;
  routineId: string | null;
  routineName: string | null;
  prescription: Record<string, unknown>;
  notes: string | null;
  routineMovements: Array<{
    id: string;
    movementId: string;
    movementName: string;
    isPerSide: boolean;
    orderIndex: number;
    prescription: Record<string, unknown>;
  }>;
}

export interface RecoveryToday {
  schedule: {
    id: string;
    name: string;
    kind: "day_keyed" | "frequency_keyed";
    rotationDays: number | null;
    weeklyTarget: number | null;
    rotationStrategy: "progress" | "calendar";
    communityId: string | null;
  } | null;
  assignmentId: string | null;
  effectiveStartsOn: string | null;
  effectiveEndsOn: string | null;
  durationLabel: string | null;
  dayIndex: number | null; // For day-keyed schedules
  weeklyCompleted: number; // For frequency-keyed schedules
  slots: RecoveryTodaySlot[];
  source: "assignment_user" | "assignment_gym" | "personal" | "none";
}

interface Chosen {
  assignmentId: string | null;
  scheduleId: string;
  effectiveStart: string;
  effectiveEnd: string | null;
  durationLabel: string | null;
  source: "assignment_user" | "assignment_gym" | "personal";
}

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay();
  const diff = (day + 6) % 7; // Monday-start week
  x.setDate(x.getDate() - diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function emptyToday(): RecoveryToday {
  return {
    schedule: null,
    assignmentId: null,
    effectiveStartsOn: null,
    effectiveEndsOn: null,
    durationLabel: null,
    dayIndex: null,
    weeklyCompleted: 0,
    slots: [],
    source: "none",
  };
}

// Hydrates a Chosen schedule into a full RecoveryToday — does the day-index
// math, slot fetch, and frequency-keyed weekly count.
async function hydrate(userId: string, date: string, chosen: Chosen): Promise<RecoveryToday> {
  const [schedule] = await db
    .select()
    .from(recoverySchedules)
    .where(eq(recoverySchedules.id, chosen.scheduleId))
    .limit(1);
  if (!schedule) return emptyToday();

  // Determine day index for day-keyed schedules.
  let dayIndex: number | null = null;
  if (schedule.kind === "day_keyed" && schedule.rotationDays && schedule.rotationDays > 0) {
    if (schedule.rotationStrategy === "calendar") {
      const start = new Date(`${chosen.effectiveStart}T00:00:00`);
      const target = new Date(`${date}T00:00:00`);
      const days = Math.floor((target.getTime() - start.getTime()) / 86400000);
      dayIndex = (days % schedule.rotationDays + schedule.rotationDays) % schedule.rotationDays + 1;
    } else {
      // Progress strategy: most recent completed session's day_index + 1, mod rotationDays.
      const [last] = await db
        .select()
        .from(recoverySessions)
        .where(
          and(
            eq(recoverySessions.userId, userId),
            eq(recoverySessions.scheduleId, schedule.id),
            eq(recoverySessions.status, "complete")
          )
        )
        .orderBy(desc(recoverySessions.sessionDate))
        .limit(1);
      const lastIdx = last?.dayIndex ?? 0;
      dayIndex = (lastIdx % schedule.rotationDays) + 1;
    }
  }

  // Slots filtered to current day (or all, for frequency-keyed).
  const slotRows = await db
    .select({
      slot: recoveryScheduleSlots,
      movementName: recoveryMovements.canonicalName,
      isPerSide: recoveryMovements.isPerSide,
      routineName: recoveryRoutines.name,
    })
    .from(recoveryScheduleSlots)
    .leftJoin(recoveryMovements, eq(recoveryScheduleSlots.movementId, recoveryMovements.id))
    .leftJoin(recoveryRoutines, eq(recoveryScheduleSlots.routineId, recoveryRoutines.id))
    .where(eq(recoveryScheduleSlots.scheduleId, schedule.id))
    .orderBy(recoveryScheduleSlots.orderIndex);

  const filteredSlots = schedule.kind === "day_keyed"
    ? slotRows.filter((s) => s.slot.dayIndex === dayIndex)
    : slotRows;

  // Pre-fetch routine children for any routine slots.
  const routineIds = filteredSlots.map((s) => s.slot.routineId).filter((x): x is string => !!x);
  const routineKids = routineIds.length
    ? await db
        .select({
          rm: recoveryRoutineMovements,
          movementName: recoveryMovements.canonicalName,
          isPerSide: recoveryMovements.isPerSide,
        })
        .from(recoveryRoutineMovements)
        .innerJoin(recoveryMovements, eq(recoveryRoutineMovements.movementId, recoveryMovements.id))
        .where(inArray(recoveryRoutineMovements.routineId, routineIds))
        .orderBy(recoveryRoutineMovements.orderIndex)
    : [];

  const kidsByRoutine = new Map<string, typeof routineKids>();
  for (const k of routineKids) {
    const arr = kidsByRoutine.get(k.rm.routineId) ?? [];
    arr.push(k);
    kidsByRoutine.set(k.rm.routineId, arr);
  }

  const slots: RecoveryTodaySlot[] = filteredSlots.map((s) => ({
    slotId: s.slot.id,
    dayIndex: s.slot.dayIndex,
    orderIndex: s.slot.orderIndex,
    movementId: s.slot.movementId,
    movementName: s.movementName ?? null,
    isPerSide: s.isPerSide ?? false,
    routineId: s.slot.routineId,
    routineName: s.routineName ?? null,
    prescription: (s.slot.prescription as Record<string, unknown>) ?? {},
    notes: s.slot.notes,
    routineMovements: s.slot.routineId
      ? (kidsByRoutine.get(s.slot.routineId) ?? []).map((k) => ({
          id: k.rm.id,
          movementId: k.rm.movementId,
          movementName: k.movementName,
          isPerSide: k.isPerSide,
          orderIndex: k.rm.orderIndex,
          prescription: (k.rm.prescription as Record<string, unknown>) ?? {},
        }))
      : [],
  }));

  // Weekly completion count for frequency-keyed.
  let weeklyCompleted = 0;
  if (schedule.kind === "frequency_keyed") {
    const wkStart = startOfWeek(new Date(`${date}T00:00:00`));
    const wkEnd = new Date(wkStart);
    wkEnd.setDate(wkEnd.getDate() + 7);
    const completedThisWeek = await db
      .select()
      .from(recoverySessions)
      .where(
        and(
          eq(recoverySessions.userId, userId),
          eq(recoverySessions.scheduleId, schedule.id),
          eq(recoverySessions.status, "complete"),
          gte(recoverySessions.sessionDate, dateKey(wkStart)),
          lte(recoverySessions.sessionDate, dateKey(wkEnd))
        )
      );
    weeklyCompleted = completedThisWeek.length;
  }

  return {
    schedule: {
      id: schedule.id,
      name: schedule.name,
      kind: schedule.kind as "day_keyed" | "frequency_keyed",
      rotationDays: schedule.rotationDays,
      weeklyTarget: schedule.weeklyTarget,
      rotationStrategy: schedule.rotationStrategy as "progress" | "calendar",
      communityId: schedule.communityId,
    },
    assignmentId: chosen.assignmentId,
    effectiveStartsOn: chosen.effectiveStart,
    effectiveEndsOn: chosen.effectiveEnd,
    durationLabel: chosen.durationLabel,
    dayIndex,
    weeklyCompleted,
    slots,
    source: chosen.source,
  };
}

// Returns the full set of choices (assignments + personal schedules) that
// should display on `date`. The page's calendar view consumes this to render
// a card per schedule.
async function pickChoices(
  userId: string,
  date: string,
  prefer: RecoveryTodayMode
): Promise<Chosen[]> {
  // 1. Active per-user assignment.
  const userAssignments = await db
    .select({
      a: recoveryScheduleAssignments,
      o: recoveryAssignmentOverrides,
    })
    .from(recoveryScheduleAssignments)
    .leftJoin(
      recoveryAssignmentOverrides,
      and(
        eq(recoveryAssignmentOverrides.assignmentId, recoveryScheduleAssignments.id),
        eq(recoveryAssignmentOverrides.userId, userId)
      )
    )
    .where(eq(recoveryScheduleAssignments.userId, userId))
    .orderBy(desc(recoveryScheduleAssignments.createdAt));

  const activeUserAssignment = userAssignments.find(({ a, o }) => {
    if (o?.isDismissed) return false;
    const start = o?.startsOn ?? a.startsOn;
    const end = o?.endsOn ?? a.endsOn;
    if (start > date) return false;
    if (end && end < date) return false;
    return true;
  });

  // 2. Caller's active gym (used for gym-wide assignment lookup AND for the
  // personal-vs-gym preference in step 3).
  const [userRow] = await db
    .select({ activeCommunityId: users.activeCommunityId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const activeGym = userRow?.activeCommunityId ?? null;

  // Assignments intentionally bypass the schedule's isActive / activeDaysOfWeek
  // filtering — coach-driven prescriptions are gated by the assignment's own
  // startsOn/endsOn (and the user's per-assignment isDismissed override),
  // not by the per-schedule day toggles that govern personal use.
  if (activeUserAssignment && (prefer === "gym" || activeUserAssignment.a.communityId === null || activeUserAssignment.a.communityId === activeGym)) {
    return [{
      assignmentId: activeUserAssignment.a.id,
      scheduleId: activeUserAssignment.a.scheduleId,
      effectiveStart: activeUserAssignment.o?.startsOn ?? activeUserAssignment.a.startsOn,
      effectiveEnd: activeUserAssignment.o?.endsOn ?? activeUserAssignment.a.endsOn,
      durationLabel: activeUserAssignment.a.durationLabel,
      source: "assignment_user",
    }];
  }

  // 3. Gym-wide assignment for caller's active gym.
  if (activeGym && prefer === "gym") {
    const gymAssignments = await db
      .select({
        a: recoveryScheduleAssignments,
        o: recoveryAssignmentOverrides,
      })
      .from(recoveryScheduleAssignments)
      .leftJoin(
        recoveryAssignmentOverrides,
        and(
          eq(recoveryAssignmentOverrides.assignmentId, recoveryScheduleAssignments.id),
          eq(recoveryAssignmentOverrides.userId, userId)
        )
      )
      .where(eq(recoveryScheduleAssignments.communityId, activeGym))
      .orderBy(desc(recoveryScheduleAssignments.createdAt));

    const active = gymAssignments.find(({ a, o }) => {
      if (o?.isDismissed) return false;
      const start = o?.startsOn ?? a.startsOn;
      const end = o?.endsOn ?? a.endsOn;
      if (start > date) return false;
      if (end && end < date) return false;
      return true;
    });

    if (active) {
      return [{
        assignmentId: active.a.id,
        scheduleId: active.a.scheduleId,
        effectiveStart: active.o?.startsOn ?? active.a.startsOn,
        effectiveEnd: active.o?.endsOn ?? active.a.endsOn,
        durationLabel: active.a.durationLabel,
        source: "assignment_gym",
      }];
    }
  }

  // 4. Personal fallback: every active personal schedule whose day-of-week
  // filter includes the target date. Each schedule renders as its own card
  // on the recovery page.
  if (prefer === "personal") {
    const personals = await db
      .select()
      .from(recoverySchedules)
      .where(
        and(
          eq(recoverySchedules.createdBy, userId),
          isNull(recoverySchedules.communityId),
          eq(recoverySchedules.isArchived, false),
          eq(recoverySchedules.isActive, true)
        )
      )
      .orderBy(desc(recoverySchedules.updatedAt));

    const target = new Date(`${date}T00:00:00`);
    const dow = target.getDay();
    const matched = personals.filter((p) => {
      // Interval recurrence (every N days) — takes precedence over the
      // day-of-week filter when set. Show only on dates that land on the
      // cadence boundary, starting on or after intervalStartsOn.
      if (p.intervalDays && p.intervalStartsOn) {
        const start = new Date(`${p.intervalStartsOn}T00:00:00`);
        const days = Math.floor((target.getTime() - start.getTime()) / 86400000);
        if (days < 0) return false;
        return days % p.intervalDays === 0;
      }
      const days = p.activeDaysOfWeek as number[] | null;
      if (days == null || days.length === 0) return true; // null = every day
      return days.includes(dow);
    });

    return matched.map((p) => ({
      assignmentId: null,
      scheduleId: p.id,
      effectiveStart: p.createdAt.toISOString().slice(0, 10),
      effectiveEnd: null,
      durationLabel: null,
      source: "personal" as const,
    }));
  }

  return [];
}

export async function resolveToday(
  userId: string,
  date: string,
  prefer: RecoveryTodayMode = "personal",
  scheduleId?: string
): Promise<RecoveryToday> {
  const choices = await pickChoices(userId, date, prefer);
  if (choices.length === 0) return emptyToday();

  const chosen = scheduleId
    ? choices.find((c) => c.scheduleId === scheduleId) ?? null
    : choices[0];
  if (!chosen) return emptyToday();

  return hydrate(userId, date, chosen);
}

export async function resolveTodayList(
  userId: string,
  date: string,
  prefer: RecoveryTodayMode = "personal"
): Promise<RecoveryToday[]> {
  const choices = await pickChoices(userId, date, prefer);
  return Promise.all(choices.map((c) => hydrate(userId, date, c)));
}
