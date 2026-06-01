import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scores } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// POST /api/scores/[id]/push-to-apple-health
//
// Called by the iOS client after it successfully writes an HKWorkout. We
// stash the workout's HK UUID on the score so repeat calls are idempotent
// — the iOS bridge checks this server-side flag before issuing a new
// HealthKit write to avoid double-rings.
//
// Body:
//   { workoutUuid: string, source?: 'model' | 'apple_health_user', replace?: boolean }
//
// `replace: true` means the client just deleted the previous HK record and
// wrote a fresh one (e.g. the score was edited). Without it the server
// short-circuits when a UUID is already stored, so edits would silently
// drop on the floor.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const workoutUuid: string | undefined = body?.workoutUuid;
  const source: string | undefined = body?.source;
  const replace: boolean = body?.replace === true;

  if (!workoutUuid || !/^[0-9a-fA-F-]{36}$/.test(workoutUuid)) {
    return NextResponse.json(
      { error: "workoutUuid (UUID) is required" },
      { status: 400 }
    );
  }

  const [row] = await db
    .select({
      id: scores.id,
      existingUuid: scores.appleHealthWorkoutUuid,
    })
    .from(scores)
    .where(and(eq(scores.id, id), eq(scores.userId, user.id)))
    .limit(1);

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.existingUuid && !replace) {
    return NextResponse.json({ status: "already_pushed", workoutUuid: row.existingUuid });
  }

  await db
    .update(scores)
    .set({
      appleHealthWorkoutUuid: workoutUuid,
      estimatedKcalSource: source === "apple_health_user" ? "apple_health_user" : "model",
      updatedAt: new Date(),
    })
    .where(eq(scores.id, id));

  return NextResponse.json({
    status: replace ? "updated" : "ok",
    workoutUuid,
  });
}
