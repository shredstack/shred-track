import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { hyroxPlanSessions, hyroxTrainingPlans } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// PUT /api/hyrox/plan/[planId]/weeks/[week]/reorder
// Body: { assignments: [{ sessionId: string, dayOfWeek: number }] }
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ planId: string; week: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { planId, week: weekStr } = await params;
  const weekNumber = parseInt(weekStr, 10);
  if (isNaN(weekNumber))
    return NextResponse.json({ error: "Invalid week" }, { status: 400 });

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

  if (!plan)
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  const body = await req.json();
  const assignments: { sessionId: string; dayOfWeek: number }[] =
    body.assignments;

  if (!Array.isArray(assignments) || assignments.length === 0)
    return NextResponse.json(
      { error: "assignments array is required" },
      { status: 400 }
    );

  // Validate dayOfWeek values
  for (const a of assignments) {
    if (typeof a.dayOfWeek !== "number" || a.dayOfWeek < 0 || a.dayOfWeek > 6)
      return NextResponse.json(
        { error: `Invalid dayOfWeek: ${a.dayOfWeek}` },
        { status: 400 }
      );
  }

  // Fetch existing sessions for this week to verify they belong to this plan/week
  const existingSessions = await db
    .select({ id: hyroxPlanSessions.id })
    .from(hyroxPlanSessions)
    .where(
      and(
        eq(hyroxPlanSessions.planId, planId),
        eq(hyroxPlanSessions.week, weekNumber)
      )
    );

  const validIds = new Set(existingSessions.map((s) => s.id));
  for (const a of assignments) {
    if (!validIds.has(a.sessionId))
      return NextResponse.json(
        { error: `Session ${a.sessionId} not found in week ${weekNumber}` },
        { status: 400 }
      );
  }

  // Apply reassignments in a transaction
  await db.transaction(async (tx) => {
    for (const a of assignments) {
      await tx
        .update(hyroxPlanSessions)
        .set({ dayOfWeek: a.dayOfWeek })
        .where(eq(hyroxPlanSessions.id, a.sessionId));
    }
  });

  return NextResponse.json({ success: true });
}
