import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scores } from "@/db/schema";
import { eq, ne, and, sql, countDistinct } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { getSessionAccess } from "@/lib/authz/workout";

// GET /api/workouts/[id]/delete-impact
// Returns counts of scores that would be cascade-deleted if this session is
// deleted, so the UI can warn before destroying other athletes' data.
// `id` is a workout_sessions.id post-cutover.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const access = await getSessionAccess(user.id, id);
  if (!access.exists) {
    return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  }
  if (!access.canEdit) {
    return NextResponse.json(
      { error: "You don't have permission to delete this workout" },
      { status: 403 }
    );
  }

  const [totals] = await db
    .select({
      totalScores: sql<number>`count(*)::int`,
      uniqueAthletes: countDistinct(scores.userId),
    })
    .from(scores)
    .where(eq(scores.workoutSessionId, id));

  const [othersRow] = await db
    .select({ count: countDistinct(scores.userId) })
    .from(scores)
    .where(and(eq(scores.workoutSessionId, id), ne(scores.userId, user.id)));

  return NextResponse.json({
    totalScores: totals?.totalScores ?? 0,
    uniqueAthletes: totals?.uniqueAthletes ?? 0,
    otherAthletes: othersRow?.count ?? 0,
  });
}
