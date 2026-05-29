import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  crossfitWorkouts,
  users,
  workoutSessions,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { getSessionAccess } from "@/lib/authz/workout";
import { computeAndStoreWorkoutEstimate } from "@/lib/calories/orchestrator";

// GET /api/workouts/[id]/calories
//   → { low, high, method, confidence, computed_at }
//
// `id` is a workout_sessions.id post-cutover. The endpoint resolves the
// session's template, then reads the template-level estimate stored on
// crossfit_workouts. The estimate is populated asynchronously by the
// Inngest `workouts/calories.compute` event fired on create/edit, so it
// may be `null` immediately after creation.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const access = await getSessionAccess(user.id, id);
  if (!access.canRead) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [row] = await db
    .select({
      low: crossfitWorkouts.estimatedKcalLow,
      high: crossfitWorkouts.estimatedKcalHigh,
      method: crossfitWorkouts.estimatedKcalMethod,
      confidence: crossfitWorkouts.estimatedKcalConfidence,
      computedAt: crossfitWorkouts.estimatedKcalComputedAt,
    })
    .from(workoutSessions)
    .innerJoin(
      crossfitWorkouts,
      eq(crossfitWorkouts.id, workoutSessions.crossfitWorkoutId)
    )
    .where(eq(workoutSessions.id, id))
    .limit(1);

  if (!row) return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  if (row.low == null) {
    return NextResponse.json({ status: "pending" });
  }
  return NextResponse.json(row);
}

// POST /api/workouts/[id]/calories — admin synchronous recompute. The
// `id` here is treated as a `crossfit_workouts.id` directly (admin tool
// invokes per-template) so the recompute hits the right row regardless
// of which session triggered it.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [u] = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!u?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const result = await computeAndStoreWorkoutEstimate(id);
  if (!result) {
    return NextResponse.json({ status: "no_parts" }, { status: 200 });
  }
  return NextResponse.json({
    low: result.low,
    high: result.high,
    active: result.active,
    gross: result.gross,
    method: result.method,
    confidence: result.confidence,
  });
}
