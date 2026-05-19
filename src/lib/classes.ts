// Class schedule helpers (spec §2.2).

import { RRule } from "rrule";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  classInstances,
  classScheduleSlots,
  classSchedules,
  communities,
} from "@/db/schema";

function addMinutes(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 60_000);
}

export interface SlotExpansion {
  startAt: Date;
  endAt: Date;
}

/**
 * Expand a slot's RRULE within [windowStart, windowEnd) using the gym's
 * timezone. The slot stores rrule + start_time (local). For each rrule
 * occurrence we attach the local start_time and resolve to a UTC instant.
 *
 * Because RRule operates on naive UTC dates while windowStart/windowEnd are
 * real UTC instants, we expand against the slot's active range first, then
 * filter to [windowStart, windowEnd] after converting each occurrence to its
 * real UTC instant. Filtering in the naive frame would drop today's still-
 * upcoming classes for gyms west of UTC.
 */
export function expandSlotOccurrences(opts: {
  rrule: string;
  startTime: string; // HH:MM:SS or HH:MM
  durationMin: number;
  activeFrom: Date;
  activeTo: Date | null;
  gymTimezone: string;
  windowStart: Date;
  windowEnd: Date;
}): SlotExpansion[] {
  if (opts.windowEnd <= opts.windowStart) return [];

  const [hh, mm, ss] = opts.startTime.split(":").map((s) => Number(s) || 0);
  const dtStart = new Date(
    Date.UTC(
      opts.activeFrom.getUTCFullYear(),
      opts.activeFrom.getUTCMonth(),
      opts.activeFrom.getUTCDate(),
      hh,
      mm,
      ss
    )
  );
  let rule: RRule;
  try {
    rule = RRule.fromString(`DTSTART:${toRruleStamp(dtStart)}\n${opts.rrule.startsWith("RRULE:") ? opts.rrule : `RRULE:${opts.rrule}`}`);
  } catch {
    return [];
  }
  // Expand across the slot's active range in the naive frame, then filter
  // post-conversion below. Add a 1-day buffer on either side so DST shifts
  // and gym tz offsets never cause the right occurrence to fall outside.
  const naiveLower = addDays(opts.activeFrom, -1);
  const naiveUpper = opts.activeTo
    ? addDays(opts.activeTo, 2)
    : addDays(opts.windowEnd, 2);
  const occurrences = rule.between(naiveLower, naiveUpper, true);
  const out: SlotExpansion[] = [];
  for (const occ of occurrences) {
    const localISO = `${occ.getUTCFullYear()}-${pad(occ.getUTCMonth() + 1)}-${pad(
      occ.getUTCDate()
    )}T${pad(hh)}:${pad(mm)}:${pad(ss)}`;
    const startUtc = gymLocalToUtc(localISO, opts.gymTimezone);
    if (startUtc < opts.windowStart) continue;
    if (startUtc >= opts.windowEnd) continue;
    if (opts.activeTo && startUtc > addDays(opts.activeTo, 1)) continue;
    out.push({
      startAt: startUtc,
      endAt: addMinutes(startUtc, opts.durationMin),
    });
  }
  return out;
}

function toRruleStamp(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

/**
 * Treat a wall-clock string in the gym's timezone as a real instant by
 * computing the timezone's UTC offset at that wall clock.
 */
export function gymLocalToUtc(localIso: string, tz: string): Date {
  // Build a fake "UTC" date that has the local clock values.
  const fake = new Date(localIso + "Z");
  // Compute what that wall clock would render as if interpreted in tz.
  const offset = tzOffsetAt(tz, fake);
  return new Date(fake.getTime() - offset);
}

/**
 * Materialize `class_instances` rows for one community's active schedule
 * slots over the next `windowDays` days. Shared by the weekly Inngest cron
 * and the schedule-creation API so coaches see classes immediately after
 * saving a schedule. Idempotent via the `(slot_id, start_at)` unique index,
 * so re-runs preserve per-instance overrides (coach swap, cancellation).
 */
export async function materializeScheduleSlotsForCommunity(opts: {
  communityId: string;
  windowDays?: number;
  scheduleIds?: string[];
}): Promise<{ slots: number; inserted: number }> {
  const windowDays = opts.windowDays ?? 84;
  const today = new Date();
  const windowEnd = new Date(today.getTime() + windowDays * 86_400_000);

  const whereClauses = [
    eq(classSchedules.isActive, true),
    eq(classSchedules.communityId, opts.communityId),
  ];
  if (opts.scheduleIds && opts.scheduleIds.length) {
    whereClauses.push(inArray(classScheduleSlots.scheduleId, opts.scheduleIds));
  }
  const slots = await db
    .select({
      slotId: classScheduleSlots.id,
      scheduleId: classScheduleSlots.scheduleId,
      rrule: classScheduleSlots.rrule,
      startTime: classScheduleSlots.startTime,
      durationMin: classScheduleSlots.durationMin,
      capacity: classScheduleSlots.capacity,
      coachId: classScheduleSlots.coachId,
      activeFrom: classScheduleSlots.activeFrom,
      activeTo: classScheduleSlots.activeTo,
      defaultCapacity: classSchedules.defaultCapacity,
      defaultCoachId: classSchedules.defaultCoachId,
      communityId: classSchedules.communityId,
      gymTimezone: communities.gymTimezone,
    })
    .from(classScheduleSlots)
    .innerJoin(
      classSchedules,
      eq(classSchedules.id, classScheduleSlots.scheduleId)
    )
    .innerJoin(communities, eq(communities.id, classSchedules.communityId))
    .where(and(...whereClauses));

  let inserted = 0;
  for (const s of slots) {
    const expansions = expandSlotOccurrences({
      rrule: s.rrule,
      startTime: s.startTime,
      durationMin: s.durationMin,
      activeFrom: new Date(`${s.activeFrom}T00:00:00Z`),
      activeTo: s.activeTo ? new Date(`${s.activeTo}T00:00:00Z`) : null,
      gymTimezone: s.gymTimezone,
      windowStart: today,
      windowEnd,
    });
    if (!expansions.length) continue;
    const rows = await db
      .insert(classInstances)
      .values(
        expansions.map((e) => ({
          slotId: s.slotId,
          scheduleId: s.scheduleId,
          communityId: s.communityId,
          startAt: e.startAt,
          endAt: e.endAt,
          coachId: s.coachId ?? s.defaultCoachId ?? null,
          capacity: s.capacity ?? s.defaultCapacity,
        }))
      )
      .onConflictDoNothing()
      .returning({ id: classInstances.id });
    inserted += rows.length;
  }
  return { slots: slots.length, inserted };
}

function tzOffsetAt(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const localUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return localUtc - at.getTime();
}
