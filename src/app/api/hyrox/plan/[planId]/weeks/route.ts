import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  hyroxTrainingPlans,
  hyroxPlanSessions,
  hyroxPlanPhases,
  hyroxSessionLogs,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// GET /api/hyrox/plan/[planId]/weeks — fetch plan weeks with sessions
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { planId } = await params;

  // Verify plan ownership
  const [plan] = await db
    .select()
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

  // Fetch phases, sessions, and session logs
  const [phases, sessions, logs] = await Promise.all([
    db
      .select()
      .from(hyroxPlanPhases)
      .where(eq(hyroxPlanPhases.planId, planId))
      .orderBy(hyroxPlanPhases.phaseNumber),
    db
      .select()
      .from(hyroxPlanSessions)
      .where(eq(hyroxPlanSessions.planId, planId))
      .orderBy(
        hyroxPlanSessions.week,
        hyroxPlanSessions.dayOfWeek,
        hyroxPlanSessions.orderInDay
      ),
    db
      .select()
      .from(hyroxSessionLogs)
      .where(eq(hyroxSessionLogs.userId, user.id)),
  ]);

  // Index logs by planSessionId for fast lookup
  const logsBySessionId = new Map(
    logs
      .filter((l) => sessions.some((s) => s.id === l.planSessionId))
      .map((l) => [l.planSessionId, l])
  );

  // Group sessions by week, attach logs
  const weekMap: Record<
    number,
    {
      weekNumber: number;
      phase: (typeof phases)[number] | null;
      sessions: (typeof sessions[number] & { log: (typeof logs)[number] | null })[];
      completionStatus: { logged: number; total: number; complete: boolean };
    }
  > = {};

  for (let w = 1; w <= plan.totalWeeks; w++) {
    const phase = phases.find((p) => w >= p.startWeek && w <= p.endWeek) ?? null;
    weekMap[w] = {
      weekNumber: w,
      phase,
      sessions: [],
      completionStatus: { logged: 0, total: 0, complete: false },
    };
  }

  for (const session of sessions) {
    if (weekMap[session.week]) {
      const log = logsBySessionId.get(session.id) ?? null;
      weekMap[session.week].sessions.push({ ...session, log });
    }
  }

  // Compute completion stats per week
  for (const week of Object.values(weekMap)) {
    const nonRest = week.sessions.filter((s) => s.sessionType !== "rest");
    const logged = nonRest.filter((s) => s.log !== null).length;
    week.completionStatus = {
      logged,
      total: nonRest.length,
      complete: nonRest.length > 0 && logged >= nonRest.length,
    };
  }

  return NextResponse.json({
    plan: {
      id: plan.id,
      title: plan.title,
      totalWeeks: plan.totalWeeks,
      startDate: plan.startDate,
      endDate: plan.endDate,
      generationStatus: plan.generationStatus,
      trainingPhilosophy: plan.trainingPhilosophy,
    },
    phases,
    weeks: Object.values(weekMap).sort((a, b) => a.weekNumber - b.weekNumber),
  });
}
