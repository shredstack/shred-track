import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { hyroxPlanSessions, hyroxTrainingPlans } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// PUT /api/hyrox/plan/sessions/[sessionId] — edit a session
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sessionId } = await params;
  const body = await req.json();

  // Fetch session and verify ownership through plan
  const [session] = await db
    .select()
    .from(hyroxPlanSessions)
    .where(eq(hyroxPlanSessions.id, sessionId))
    .limit(1);

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const [plan] = await db
    .select({ id: hyroxTrainingPlans.id })
    .from(hyroxTrainingPlans)
    .where(
      and(
        eq(hyroxTrainingPlans.id, session.planId),
        eq(hyroxTrainingPlans.userId, user.id)
      )
    )
    .limit(1);

  if (!plan) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // Save original data if this is the first edit
  const originalData = session.athleteModified
    ? session.originalSessionData
    : {
        title: session.title,
        description: session.description,
        sessionType: session.sessionType,
        targetPace: session.targetPace,
        durationMinutes: session.durationMinutes,
        sessionDetail: session.sessionDetail,
        equipmentRequired: session.equipmentRequired,
      };

  const [updated] = await db
    .update(hyroxPlanSessions)
    .set({
      title: body.title ?? session.title,
      description: body.description ?? session.description,
      sessionType: body.sessionType ?? session.sessionType,
      targetPace: body.targetPace ?? session.targetPace,
      durationMinutes: body.durationMinutes ?? session.durationMinutes,
      sessionDetail: body.sessionDetail ?? session.sessionDetail,
      equipmentRequired: body.equipmentRequired ?? session.equipmentRequired,
      athleteModified: true,
      originalSessionData: originalData,
    })
    .where(eq(hyroxPlanSessions.id, sessionId))
    .returning();

  return NextResponse.json(updated);
}
