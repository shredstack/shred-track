import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  hyroxTrainingPlans,
  hyroxPlanSessions,
  hyroxSessionLogs,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// GET /api/hyrox/plan/[planId]/progress — aggregated log data for progress tracking
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { planId } = await params;

  // Verify plan ownership
  const [plan] = await db
    .select({ id: hyroxTrainingPlans.id })
    .from(hyroxTrainingPlans)
    .where(
      and(
        eq(hyroxTrainingPlans.id, planId),
        eq(hyroxTrainingPlans.userId, user.id)
      )
    )
    .limit(1);

  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  // Fetch all sessions and their logs
  const sessions = await db
    .select()
    .from(hyroxPlanSessions)
    .where(eq(hyroxPlanSessions.planId, planId))
    .orderBy(hyroxPlanSessions.week, hyroxPlanSessions.dayOfWeek);

  const sessionIds = sessions.map((s) => s.id);

  const logs = await db
    .select()
    .from(hyroxSessionLogs)
    .where(eq(hyroxSessionLogs.userId, user.id));

  // Index logs by session ID
  const logMap = new Map(
    logs
      .filter((l) => sessionIds.includes(l.planSessionId))
      .map((l) => [l.planSessionId, l])
  );

  // Build run progress entries
  const runs: {
    week: number;
    sessionTitle: string;
    sessionType: string;
    loggedAt: string;
    actualPace: string | null;
    actualPaceUnit: string | null;
    actualDistanceValue: string | null;
    actualDistanceUnit: string | null;
    targetPace: string | null;
    rpe: number | null;
  }[] = [];

  // Build station progress entries
  const stations: {
    week: number;
    sessionTitle: string;
    sessionType: string;
    loggedAt: string;
    actualTimeSeconds: number | null;
    actualReps: number | null;
    actualWeightValue: string | null;
    actualWeightUnit: string | null;
    rpe: number | null;
  }[] = [];

  // Weekly totals
  const weekTotals: Record<
    number,
    {
      totalDistanceKm: number;
      rpeSum: number;
      rpeCount: number;
      sessionsCompleted: number;
      sessionsTotal: number;
    }
  > = {};

  for (const session of sessions) {
    const log = logMap.get(session.id);
    const isNonRest = session.sessionType !== "rest";

    // Init week totals
    if (!weekTotals[session.week]) {
      weekTotals[session.week] = {
        totalDistanceKm: 0,
        rpeSum: 0,
        rpeCount: 0,
        sessionsCompleted: 0,
        sessionsTotal: 0,
      };
    }
    if (isNonRest) {
      weekTotals[session.week].sessionsTotal++;
    }

    if (!log || log.status !== "completed") continue;

    if (isNonRest) {
      weekTotals[session.week].sessionsCompleted++;
    }
    if (log.rpe != null) {
      weekTotals[session.week].rpeSum += log.rpe;
      weekTotals[session.week].rpeCount++;
    }

    // Distance accumulation (normalize to km)
    if (log.actualDistanceValue) {
      const val = parseFloat(log.actualDistanceValue);
      if (!isNaN(val)) {
        const km = log.actualDistanceUnit === "mi" ? val * 1.60934 : val;
        weekTotals[session.week].totalDistanceKm += km;
      }
    }

    // Categorize into runs vs stations
    if (session.sessionType === "run" || session.sessionType === "hyrox_day") {
      if (log.actualPace || log.actualDistanceValue) {
        runs.push({
          week: session.week,
          sessionTitle: session.title,
          sessionType: session.sessionType,
          loggedAt: log.loggedAt.toISOString(),
          actualPace: log.actualPace,
          actualPaceUnit: log.actualPaceUnit,
          actualDistanceValue: log.actualDistanceValue,
          actualDistanceUnit: log.actualDistanceUnit,
          targetPace: session.targetPace,
          rpe: log.rpe,
        });
      }
    }

    if (
      session.sessionType === "station_skills" ||
      session.sessionType === "hyrox_day"
    ) {
      if (log.actualTimeSeconds != null || log.actualReps != null) {
        stations.push({
          week: session.week,
          sessionTitle: session.title,
          sessionType: session.sessionType,
          loggedAt: log.loggedAt.toISOString(),
          actualTimeSeconds: log.actualTimeSeconds,
          actualReps: log.actualReps,
          actualWeightValue: log.actualWeightValue,
          actualWeightUnit: log.actualWeightUnit,
          rpe: log.rpe,
        });
      }
    }
  }

  const weeklyTotals = Object.entries(weekTotals)
    .map(([week, t]) => ({
      week: parseInt(week, 10),
      totalDistanceKm: Math.round(t.totalDistanceKm * 100) / 100,
      avgRpe:
        t.rpeCount > 0
          ? Math.round((t.rpeSum / t.rpeCount) * 10) / 10
          : null,
      sessionsCompleted: t.sessionsCompleted,
      sessionsTotal: t.sessionsTotal,
    }))
    .sort((a, b) => a.week - b.week);

  return NextResponse.json({ runs, stations, weeklyTotals });
}
