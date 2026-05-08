import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  recoverySessions,
  recoverySessionItems,
  recoveryMovements,
  recoveryMovementVideos,
  communityMemberships,
} from "@/db/schema";
import { and, eq, desc, gte, lte, inArray } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { resolveToday, resolveTodayList } from "@/lib/recovery/today-resolver";

// GET — two modes:
//   ?date=YYYY-MM-DD : returns the resolved today view as a list — every
//                      schedule that should display on this date, each with
//                      any in-progress session attached. Personal users will
//                      see one entry per active schedule whose day-of-week
//                      filter includes the date.
//   ?startDate&endDate : history list (caller's sessions only).
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const date = req.nextUrl.searchParams.get("date");
  const startDate = req.nextUrl.searchParams.get("startDate");
  const endDate = req.nextUrl.searchParams.get("endDate");
  const prefer = req.nextUrl.searchParams.get("prefer") === "gym" ? "gym" : "personal";

  if (date) {
    const todays = await resolveTodayList(user.id, date, prefer);
    const scheduleIds = todays
      .map((t) => t.schedule?.id)
      .filter((id): id is string => !!id);

    // Single batched fetch for any sessions that already exist for these
    // (user, date, scheduleId) triples.
    const sessionsByScheduleId = new Map<string, { id: string; status: string }>();
    if (scheduleIds.length) {
      const rows = await db
        .select()
        .from(recoverySessions)
        .where(
          and(
            eq(recoverySessions.userId, user.id),
            eq(recoverySessions.sessionDate, date),
            inArray(recoverySessions.scheduleId, scheduleIds)
          )
        );
      for (const r of rows) {
        if (r.scheduleId) sessionsByScheduleId.set(r.scheduleId, { id: r.id, status: r.status });
      }
    }

    // Hydrate session items + videos per existing session.
    const allSessionIds = [...sessionsByScheduleId.values()].map((s) => s.id);
    let itemsBySession = new Map<string, Array<{
      i: typeof recoverySessionItems.$inferSelect;
      movementName: string;
      isPerSide: boolean;
      description: string | null;
    }>>();
    let videosByMovement = new Map<string, RecoveryVideoRow[]>();
    if (allSessionIds.length) {
      const items = await db
        .select({
          i: recoverySessionItems,
          movementName: recoveryMovements.canonicalName,
          isPerSide: recoveryMovements.isPerSide,
          description: recoveryMovements.description,
        })
        .from(recoverySessionItems)
        .innerJoin(recoveryMovements, eq(recoverySessionItems.movementId, recoveryMovements.id))
        .where(inArray(recoverySessionItems.sessionId, allSessionIds))
        .orderBy(recoverySessionItems.orderIndex);
      itemsBySession = new Map();
      for (const row of items) {
        const arr = itemsBySession.get(row.i.sessionId) ?? [];
        arr.push(row);
        itemsBySession.set(row.i.sessionId, arr);
      }
      const movementIds = Array.from(new Set(items.map((row) => row.i.movementId)));
      videosByMovement = await fetchVisibleVideosByMovement(user.id, movementIds);
    }

    const result = todays.map((today) => {
      let existingSession = null as null | { id: string; status: string; items: unknown[] };
      const summary = today.schedule ? sessionsByScheduleId.get(today.schedule.id) : undefined;
      if (summary) {
        const items = itemsBySession.get(summary.id) ?? [];
        existingSession = {
          id: summary.id,
          status: summary.status,
          items: items.map((row) => ({
            ...row.i,
            movementName: row.movementName,
            isPerSide: row.isPerSide,
            description: row.description,
            videos: videosByMovement.get(row.i.movementId) ?? [],
          })),
        };
      }
      return { ...today, session: existingSession };
    });

    return NextResponse.json(result);
  }

  if (startDate && endDate) {
    const sessions = await db
      .select()
      .from(recoverySessions)
      .where(
        and(
          eq(recoverySessions.userId, user.id),
          gte(recoverySessions.sessionDate, startDate),
          lte(recoverySessions.sessionDate, endDate)
        )
      )
      .orderBy(desc(recoverySessions.sessionDate));

    if (sessions.length === 0) return NextResponse.json([]);

    const ids = sessions.map((s) => s.id);
    const items = await db
      .select({
        i: recoverySessionItems,
        movementName: recoveryMovements.canonicalName,
      })
      .from(recoverySessionItems)
      .innerJoin(recoveryMovements, eq(recoverySessionItems.movementId, recoveryMovements.id))
      .where(inArray(recoverySessionItems.sessionId, ids))
      .orderBy(recoverySessionItems.orderIndex);

    const itemsBySession = new Map<string, typeof items>();
    for (const row of items) {
      const arr = itemsBySession.get(row.i.sessionId) ?? [];
      arr.push(row);
      itemsBySession.set(row.i.sessionId, arr);
    }

    return NextResponse.json(
      sessions.map((s) => ({
        ...s,
        items: (itemsBySession.get(s.id) ?? []).map((row) => ({
          ...row.i,
          movementName: row.movementName,
        })),
      }))
    );
  }

  // Default: caller's most recent sessions (last 30).
  const recent = await db
    .select()
    .from(recoverySessions)
    .where(eq(recoverySessions.userId, user.id))
    .orderBy(desc(recoverySessions.sessionDate))
    .limit(30);
  return NextResponse.json(recent);
}

// POST — start a session. Body: { date, prefer?, scheduleId? }
// Snapshots the resolver's slots into recovery_session_items. With multiple
// schedules potentially active on the same date, the caller passes
// scheduleId to specify which one to start; omitting it falls back to the
// first resolved choice (preserves single-schedule behavior).
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const date = typeof body.date === "string" ? body.date : null;
  if (!date) return NextResponse.json({ error: "date required" }, { status: 400 });
  const prefer = body.prefer === "gym" ? "gym" : "personal";
  const scheduleId = typeof body.scheduleId === "string" ? body.scheduleId : undefined;

  const today = await resolveToday(user.id, date, prefer, scheduleId);
  if (!today.schedule) {
    return NextResponse.json({ error: "No schedule active for this date" }, { status: 400 });
  }

  // Idempotent: return existing session for the (user, date, schedule).
  const [existing] = await db
    .select()
    .from(recoverySessions)
    .where(
      and(
        eq(recoverySessions.userId, user.id),
        eq(recoverySessions.sessionDate, date),
        eq(recoverySessions.scheduleId, today.schedule.id)
      )
    )
    .limit(1);
  if (existing) return NextResponse.json(existing);

  const result = await db.transaction(async (tx) => {
    const [session] = await tx
      .insert(recoverySessions)
      .values({
        userId: user.id,
        scheduleId: today.schedule!.id,
        assignmentId: today.assignmentId,
        sessionDate: date,
        dayIndex: today.dayIndex,
        status: "in_progress",
      })
      .returning();

    if (today.slots.length) {
      // Expand routines into their child movements; otherwise insert a single
      // item per slot.
      const itemValues: Array<{
        sessionId: string;
        movementId: string;
        routineId: string | null;
        scheduleSlotId: string;
        orderIndex: number;
        prescribed: Record<string, unknown>;
      }> = [];
      let i = 0;
      for (const slot of today.slots) {
        if (slot.routineId && slot.routineMovements.length > 0) {
          for (const child of slot.routineMovements) {
            const merged = { ...slot.prescription, ...child.prescription };
            itemValues.push({
              sessionId: session.id,
              movementId: child.movementId,
              routineId: slot.routineId,
              scheduleSlotId: slot.slotId,
              orderIndex: i++,
              prescribed: merged,
            });
          }
        } else if (slot.movementId) {
          itemValues.push({
            sessionId: session.id,
            movementId: slot.movementId,
            routineId: null,
            scheduleSlotId: slot.slotId,
            orderIndex: i++,
            prescribed: slot.prescription,
          });
        }
      }
      if (itemValues.length) {
        await tx.insert(recoverySessionItems).values(itemValues);
      }
    }

    return session;
  });

  return NextResponse.json(result, { status: 201 });
}

type RecoveryVideoRow = typeof recoveryMovementVideos.$inferSelect;

// Fetch every video for the given movements, then keep only the ones the
// caller is allowed to see (mirrors the per-movement videos GET endpoint's
// visibility rules so the session view doesn't leak gym/private uploads).
async function fetchVisibleVideosByMovement(
  userId: string,
  movementIds: string[]
): Promise<Map<string, RecoveryVideoRow[]>> {
  const grouped = new Map<string, RecoveryVideoRow[]>();
  if (movementIds.length === 0) return grouped;

  const memberships = await db
    .select({ communityId: communityMemberships.communityId })
    .from(communityMemberships)
    .where(
      and(eq(communityMemberships.userId, userId), eq(communityMemberships.isActive, true))
    );
  const myGyms = memberships.map((m) => m.communityId);

  const videoRows = await db
    .select()
    .from(recoveryMovementVideos)
    .where(inArray(recoveryMovementVideos.movementId, movementIds))
    .orderBy(recoveryMovementVideos.orderIndex, recoveryMovementVideos.createdAt);

  for (const v of videoRows) {
    const visible =
      v.visibility === "public" ||
      (v.visibility === "gym" && v.communityId && myGyms.includes(v.communityId)) ||
      (v.visibility === "private" && v.uploadedBy === userId);
    if (!visible) continue;
    const arr = grouped.get(v.movementId) ?? [];
    arr.push(v);
    grouped.set(v.movementId, arr);
  }
  return grouped;
}
