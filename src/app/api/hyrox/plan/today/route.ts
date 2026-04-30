import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  hyroxTrainingPlans,
  hyroxPlanSessions,
  hyroxPlanPhases,
  hyroxSessionLogs,
} from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// GET /api/hyrox/plan/today
//
// Returns the user's HYROX plan session(s) for today (or for ?date=YYYY-MM-DD).
// Used by the native + Watch "Today" tab.
//
// Response shape:
//   { plan: null }                                      — no active plan
//   { plan: {...}, week, dayOfWeek, rest: true }        — rest day
//   { plan: {...}, week, dayOfWeek, sessions: [...], log }  — training day
//
// Day-of-week convention: 0 = Mon … 6 = Sun (matches plan-generator + sessions).

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function parseDateParam(input: string | null): Date {
  if (!input) return new Date();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!m) return new Date();
  const [, y, mo, d] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d));
}

function diffInDaysUTC(later: Date, earlier: Date): number {
  const a = Date.UTC(later.getFullYear(), later.getMonth(), later.getDate());
  const b = Date.UTC(
    earlier.getFullYear(),
    earlier.getMonth(),
    earlier.getDate(),
  );
  return Math.floor((a - b) / (1000 * 60 * 60 * 24));
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dateParam = req.nextUrl.searchParams.get("date");
  const target = parseDateParam(dateParam);

  const [plan] = await db
    .select()
    .from(hyroxTrainingPlans)
    .where(
      and(
        eq(hyroxTrainingPlans.userId, user.id),
        eq(hyroxTrainingPlans.status, "active"),
      ),
    )
    .orderBy(desc(hyroxTrainingPlans.createdAt))
    .limit(1);

  if (!plan) {
    return NextResponse.json({ plan: null });
  }

  // plan.startDate is YYYY-MM-DD; treat as local date.
  const startParts = plan.startDate.split("-").map(Number);
  const startDate = new Date(startParts[0], startParts[1] - 1, startParts[2]);

  const daysSinceStart = diffInDaysUTC(target, startDate);
  if (daysSinceStart < 0 || daysSinceStart >= plan.totalWeeks * 7) {
    // Today falls outside the plan's window.
    return NextResponse.json({
      plan: {
        id: plan.id,
        title: plan.title,
        startDate: plan.startDate,
        endDate: plan.endDate,
      },
      week: null,
      dayOfWeek: null,
      outOfRange: true,
      sessions: [],
    });
  }

  const week = Math.floor(daysSinceStart / 7) + 1;
  const dayOfWeek = daysSinceStart % 7; // 0=Mon … 6=Sun (plan startDate is the week-1 Monday)

  const [sessions, phases] = await Promise.all([
    db
      .select()
      .from(hyroxPlanSessions)
      .where(
        and(
          eq(hyroxPlanSessions.planId, plan.id),
          eq(hyroxPlanSessions.week, week),
          eq(hyroxPlanSessions.dayOfWeek, dayOfWeek),
        ),
      )
      .orderBy(hyroxPlanSessions.orderInDay),
    db
      .select()
      .from(hyroxPlanPhases)
      .where(eq(hyroxPlanPhases.planId, plan.id)),
  ]);

  const phase = phases.find(
    (p) => week >= p.startWeek && week <= p.endWeek,
  ) ?? null;

  // Attach session logs for completion state on the Watch / native UI.
  const sessionIds = sessions.map((s) => s.id);
  const logs = sessionIds.length
    ? await db
        .select()
        .from(hyroxSessionLogs)
        .where(eq(hyroxSessionLogs.userId, user.id))
    : [];
  const logsBySessionId = new Map(
    logs.filter((l) => sessionIds.includes(l.planSessionId)).map((l) => [
      l.planSessionId,
      l,
    ]),
  );

  const sessionsWithLogs = sessions.map((s) => ({
    ...s,
    log: logsBySessionId.get(s.id) ?? null,
  }));

  const isRestDay =
    sessions.length === 0 ||
    sessions.every((s) => s.sessionType === "rest");

  return NextResponse.json({
    plan: {
      id: plan.id,
      title: plan.title,
      startDate: plan.startDate,
      endDate: plan.endDate,
      planType: plan.planType,
    },
    phase,
    week,
    dayOfWeek,
    dayLabel: DAY_NAMES[dayOfWeek],
    rest: isRestDay,
    sessions: sessionsWithLogs,
  });
}
