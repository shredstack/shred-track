// GET /api/crossfit/workouts/[id]/prep-signals
//
// Returns the per-workout prep-card payload — stretch goals lifted from
// the user's recent performance signals plus movement-attributed
// complaint banners. See
// claude_code_instructions/crossfit_improvements/notes_insights_v2_spec.md
// §2.1–2.2.
//
// `id` is a workout_sessions.id. The handler resolves it to the linked
// template internally; freeform sessions (no template) return an empty
// payload so the card silently hides.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getWorkoutPrepSignals } from "@/lib/crossfit/insights/prep-signals";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { error: "Workout id required" },
      { status: 400 }
    );
  }

  const payload = await getWorkoutPrepSignals({
    userId: user.id,
    workoutId: id,
  });
  return NextResponse.json(payload);
}
