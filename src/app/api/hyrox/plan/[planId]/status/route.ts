import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { hyroxTrainingPlans, hyroxPlanSessions } from "@/db/schema";
import { eq, and, count } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// GET /api/hyrox/plan/[planId]/status — poll generation status
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { planId } = await params;

  const [plan] = await db
    .select({
      id: hyroxTrainingPlans.id,
      title: hyroxTrainingPlans.title,
      generationStatus: hyroxTrainingPlans.generationStatus,
      totalWeeks: hyroxTrainingPlans.totalWeeks,
      createdAt: hyroxTrainingPlans.createdAt,
    })
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

  // Include session count so the client can show generation progress
  let sessionsGenerated = 0;
  if (plan.generationStatus === "generating" || plan.generationStatus === "completed") {
    const [result] = await db
      .select({ count: count() })
      .from(hyroxPlanSessions)
      .where(eq(hyroxPlanSessions.planId, planId));
    sessionsGenerated = result?.count ?? 0;
  }

  // Expected ~7 sessions per week
  const expectedSessions = plan.totalWeeks ? plan.totalWeeks * 7 : 0;

  return NextResponse.json({
    ...plan,
    sessionsGenerated,
    expectedSessions,
  });
}
