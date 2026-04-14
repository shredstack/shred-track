import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  hyroxPlanSessions,
  hyroxTrainingPlans,
  hyroxSessionLogs,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

async function verifySessionOwnership(sessionId: string, userId: string) {
  const [session] = await db
    .select()
    .from(hyroxPlanSessions)
    .where(eq(hyroxPlanSessions.id, sessionId))
    .limit(1);

  if (!session) return null;

  const [plan] = await db
    .select({ id: hyroxTrainingPlans.id })
    .from(hyroxTrainingPlans)
    .where(
      and(
        eq(hyroxTrainingPlans.id, session.planId),
        eq(hyroxTrainingPlans.userId, userId)
      )
    )
    .limit(1);

  if (!plan) return null;
  return session;
}

// GET /api/hyrox/plan/sessions/[sessionId]/log — fetch existing log
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sessionId } = await params;
  const session = await verifySessionOwnership(sessionId, user.id);
  if (!session)
    return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const [log] = await db
    .select()
    .from(hyroxSessionLogs)
    .where(
      and(
        eq(hyroxSessionLogs.planSessionId, sessionId),
        eq(hyroxSessionLogs.userId, user.id)
      )
    )
    .limit(1);

  return NextResponse.json(log ?? null);
}

// POST /api/hyrox/plan/sessions/[sessionId]/log — upsert session log
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sessionId } = await params;
  const session = await verifySessionOwnership(sessionId, user.id);
  if (!session)
    return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const body = await req.json();

  if (!body.status || !["completed", "skipped", "modified"].includes(body.status)) {
    return NextResponse.json(
      { error: "status is required and must be 'completed', 'skipped', or 'modified'" },
      { status: 400 }
    );
  }

  const logData = {
    planSessionId: sessionId,
    userId: user.id,
    status: body.status as string,
    actualPace: body.actualPace ?? null,
    actualPaceUnit: body.actualPaceUnit ?? null,
    actualTimeSeconds: body.actualTimeSeconds ?? null,
    actualReps: body.actualReps ?? null,
    actualDistance: body.actualDistance ?? null,
    actualDistanceValue: body.actualDistanceValue != null ? String(body.actualDistanceValue) : null,
    actualDistanceUnit: body.actualDistanceUnit ?? null,
    actualWeight: body.actualWeight ?? null,
    actualWeightValue: body.actualWeightValue != null ? String(body.actualWeightValue) : null,
    actualWeightUnit: body.actualWeightUnit ?? null,
    movementResults: body.movementResults ?? null,
    rpe: body.rpe ?? null,
    notes: body.notes ?? null,
  };

  const [result] = await db
    .insert(hyroxSessionLogs)
    .values(logData)
    .onConflictDoUpdate({
      target: [hyroxSessionLogs.planSessionId, hyroxSessionLogs.userId],
      set: {
        status: logData.status,
        actualPace: logData.actualPace,
        actualPaceUnit: logData.actualPaceUnit,
        actualTimeSeconds: logData.actualTimeSeconds,
        actualReps: logData.actualReps,
        actualDistance: logData.actualDistance,
        actualDistanceValue: logData.actualDistanceValue,
        actualDistanceUnit: logData.actualDistanceUnit,
        actualWeight: logData.actualWeight,
        actualWeightValue: logData.actualWeightValue,
        actualWeightUnit: logData.actualWeightUnit,
        movementResults: logData.movementResults,
        rpe: logData.rpe,
        notes: logData.notes,
        loggedAt: new Date(),
      },
    })
    .returning();

  return NextResponse.json(result);
}
