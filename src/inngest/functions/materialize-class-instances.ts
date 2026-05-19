// materialize-class-instances (spec §2.2)
//
// Daily cron. Expands every active class_schedule_slot 4 weeks ahead via
// RRULE and inserts class_instances rows that don't yet exist. Idempotent:
// the (slot_id, start_at) unique index guarantees re-runs are no-ops.

import { and, eq, isNull, lte, or } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "@/db";
import {
  classScheduleSlots,
  classSchedules,
  classInstances,
  communities,
} from "@/db/schema";
import { expandSlotOccurrences } from "@/lib/classes";

const CRON = "0 9 * * *"; // daily 09:00 UTC

export const materializeClassInstances = inngest.createFunction(
  {
    id: "classes-materialize-instances",
    retries: 1,
    triggers: [{ cron: CRON }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ step }: { step: any }) => {
    const today = new Date();
    const fourWeeks = new Date(today.getTime() + 28 * 86_400_000);

    const slots = (await step.run("list-active-slots", async () => {
      return db
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
          isActive: classSchedules.isActive,
          gymTimezone: communities.gymTimezone,
        })
        .from(classScheduleSlots)
        .innerJoin(
          classSchedules,
          eq(classSchedules.id, classScheduleSlots.scheduleId)
        )
        .innerJoin(communities, eq(communities.id, classSchedules.communityId))
        .where(
          and(
            eq(classSchedules.isActive, true),
            or(
              isNull(classScheduleSlots.activeTo),
              lte(
                sql`${classScheduleSlots.activeFrom}`,
                fourWeeks.toISOString().slice(0, 10)
              )
            )
          )
        );
    })) as Array<{
      slotId: string;
      scheduleId: string;
      rrule: string;
      startTime: string;
      durationMin: number;
      capacity: number | null;
      coachId: string | null;
      activeFrom: string;
      activeTo: string | null;
      defaultCapacity: number;
      defaultCoachId: string | null;
      communityId: string;
      gymTimezone: string;
    }>;

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
        windowEnd: fourWeeks,
      });
      if (!expansions.length) continue;
      const result = (await step.run(`insert-slot-${s.slotId}`, async () => {
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
        return rows.length;
      })) as number;
      inserted += result;
    }

    return { slots: slots.length, inserted };
  }
);
