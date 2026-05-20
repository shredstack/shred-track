import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scores } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// GET /api/scores/[id]/calories
//   → { estimated, estimated_active, estimated_with_epoc,
//        estimated_active_with_epoc, epoc_applied, source,
//        bodyweight_lb_at_score, confidence, method }
//
// Scoped to the score's owner. Useful for the post-score summary, the
// share-card preview, and any external integration we expose later.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const [row] = await db
    .select({
      estimated: scores.estimatedKcal,
      estimatedActive: scores.estimatedKcalActive,
      estimatedWithEpoc: scores.estimatedKcalWithEpoc,
      estimatedActiveWithEpoc: scores.estimatedKcalActiveWithEpoc,
      method: scores.estimatedKcalMethod,
      confidence: scores.estimatedKcalConfidence,
      source: scores.estimatedKcalSource,
      bodyweightLbAtScore: scores.bodyweightLbAtScore,
      appleHealthWorkoutUuid: scores.appleHealthWorkoutUuid,
      startedAt: scores.startedAt,
      endedAt: scores.endedAt,
      durationSeconds: scores.durationSeconds,
    })
    .from(scores)
    .where(and(eq(scores.id, id), eq(scores.userId, user.id)))
    .limit(1);

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    ...row,
    epocApplied:
      row.estimated != null &&
      row.estimatedWithEpoc != null &&
      row.estimatedWithEpoc > row.estimated,
  });
}
