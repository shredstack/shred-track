import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { hyroxTrainingPlans } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { inngest } from "@/inngest/client";
import type { AthleteSnapshot } from "@/types/hyrox-plan";

// POST /api/hyrox/plan/[planId]/weeks/[week]/regenerate — regenerate a single week
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ planId: string; week: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { planId, week } = await params;
  const weekNumber = parseInt(week, 10);

  if (isNaN(weekNumber) || weekNumber < 1) {
    return NextResponse.json({ error: "Invalid week number" }, { status: 400 });
  }

  // Verify plan ownership and get snapshot
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

  if (weekNumber > plan.totalWeeks) {
    return NextResponse.json({ error: "Week exceeds plan length" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const constraints = body.constraints ?? "";

  const snapshot = plan.athleteSnapshot as AthleteSnapshot;
  if (!snapshot) {
    return NextResponse.json(
      { error: "Plan has no athlete snapshot — cannot regenerate" },
      { status: 400 }
    );
  }

  await inngest.send({
    name: "hyrox/week.regenerate",
    data: {
      planId,
      weekNumber,
      constraints,
      snapshot,
    },
  });

  return NextResponse.json(
    { planId, weekNumber, status: "regenerating" },
    { status: 202 }
  );
}
