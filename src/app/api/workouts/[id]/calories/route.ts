import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, workouts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { getWorkoutAccess } from "@/lib/authz/workout";
import {
  computeAndStoreWorkoutEstimate,
} from "@/lib/calories/orchestrator";

// GET /api/workouts/[id]/calories
//   → { low, high, active, gross, method, confidence, computed_at }
//
// Reads the stored template-level estimate from `workouts`. The estimate is
// populated asynchronously by the Inngest `workouts/calories.compute` event
// fired on create/edit — so it may be `null` immediately after creation.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const access = await getWorkoutAccess(user.id, id);
  if (!access.canRead) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [row] = await db
    .select({
      low: workouts.estimatedKcalLow,
      high: workouts.estimatedKcalHigh,
      method: workouts.estimatedKcalMethod,
      confidence: workouts.estimatedKcalConfidence,
      computedAt: workouts.estimatedKcalComputedAt,
    })
    .from(workouts)
    .where(eq(workouts.id, id))
    .limit(1);

  if (!row) return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  if (row.low == null) {
    return NextResponse.json({ status: "pending" });
  }
  return NextResponse.json(row);
}

// POST /api/workouts/[id]/calories/recompute — admin only synchronous
// recompute. Useful for the admin movement-MET editor to recompute on demand.
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
