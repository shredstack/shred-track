import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { hyroxTrainingPlans, hyroxRaceScenarios } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// GET /api/hyrox/plan/[planId]/scenarios — fetch race-day scenarios
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

  const scenarios = await db
    .select()
    .from(hyroxRaceScenarios)
    .where(eq(hyroxRaceScenarios.planId, planId))
    .orderBy(hyroxRaceScenarios.sortOrder);

  return NextResponse.json(scenarios);
}
