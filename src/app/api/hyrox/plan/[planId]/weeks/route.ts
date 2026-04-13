import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  hyroxTrainingPlans,
  hyroxPlanSessions,
  hyroxPlanPhases,
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

  // Fetch phases and sessions
  const [phases, sessions] = await Promise.all([
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
  ]);

  // Group sessions by week
  const weekMap: Record<
    number,
    {
      weekNumber: number;
      phase: (typeof phases)[number] | null;
      sessions: (typeof sessions)[number][];
    }
  > = {};

  for (let w = 1; w <= plan.totalWeeks; w++) {
    const phase = phases.find((p) => w >= p.startWeek && w <= p.endWeek) ?? null;
    weekMap[w] = { weekNumber: w, phase, sessions: [] };
  }

  for (const session of sessions) {
    if (weekMap[session.week]) {
      weekMap[session.week].sessions.push(session);
    }
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
