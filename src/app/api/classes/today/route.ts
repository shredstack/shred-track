// GET /api/classes/today
//
// Returns the user's class registrations whose start_at falls on the
// requested local date. Used by the iOS notification scheduler so it
// can fire a "log your WOD" reminder a few hours after class.
//
// Query params:
//   date              YYYY-MM-DD (local). Defaults to server UTC today.
//   tzOffsetMinutes   Output of `Date.prototype.getTimezoneOffset()`,
//                     so for the user's local "today" we can derive the
//                     correct UTC window. Defaults to 0.
//
// Returns: { date, registrations: [{ classInstanceId, communityId,
//            communityName, scheduleName, startAt (ISO), endAt (ISO),
//            status, kind }] }, ordered by startAt ascending.

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, gte, lt, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  classInstances,
  classRegistrations,
  classSchedules,
  communities,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";

function parseDateParam(input: string | null): string {
  if (input && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function localDayWindowUtc(date: string, tzOffsetMinutes: number): {
  start: Date;
  end: Date;
} {
  // `tzOffsetMinutes` matches `Date.prototype.getTimezoneOffset()`:
  // UTC = local + offset. So midnight local in UTC is:
  //   date 00:00 + offset minutes.
  const [y, m, d] = date.split("-").map(Number);
  const startMs = Date.UTC(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0)
    + tzOffsetMinutes * 60_000;
  return {
    start: new Date(startMs),
    end: new Date(startMs + 24 * 60 * 60_000),
  };
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const date = parseDateParam(req.nextUrl.searchParams.get("date"));
  const tzRaw = req.nextUrl.searchParams.get("tzOffsetMinutes");
  const tzOffsetMinutes = Number.isFinite(Number(tzRaw)) ? Number(tzRaw) : 0;
  const { start, end } = localDayWindowUtc(date, tzOffsetMinutes);

  const rows = await db
    .select({
      registrationId: classRegistrations.id,
      status: classRegistrations.status,
      classInstanceId: classInstances.id,
      communityId: classInstances.communityId,
      startAt: classInstances.startAt,
      endAt: classInstances.endAt,
      kind: classInstances.kind,
      instanceStatus: classInstances.status,
      eventTitle: classInstances.eventTitle,
      scheduleName: classSchedules.name,
      communityName: communities.name,
    })
    .from(classRegistrations)
    .innerJoin(
      classInstances,
      eq(classInstances.id, classRegistrations.classInstanceId),
    )
    .leftJoin(classSchedules, eq(classSchedules.id, classInstances.scheduleId))
    .leftJoin(communities, eq(communities.id, classInstances.communityId))
    .where(
      and(
        eq(classRegistrations.userId, user.id),
        ne(classRegistrations.status, "cancelled"),
        ne(classInstances.status, "cancelled"),
        gte(classInstances.startAt, start),
        lt(classInstances.startAt, end),
      ),
    )
    .orderBy(asc(classInstances.startAt));

  return NextResponse.json({
    date,
    registrations: rows.map((r) => ({
      registrationId: r.registrationId,
      classInstanceId: r.classInstanceId,
      communityId: r.communityId,
      communityName: r.communityName ?? null,
      name:
        r.kind === "event"
          ? r.eventTitle ?? r.scheduleName ?? "Event"
          : r.scheduleName ?? "Class",
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
      status: r.status,
      kind: r.kind,
    })),
  });
}
