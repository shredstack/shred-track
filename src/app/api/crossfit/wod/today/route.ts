import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { workouts, communityMemberships, communities } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// GET /api/crossfit/wod/today
//
// Returns published WODs scheduled for today (or for ?date=YYYY-MM-DD) from
// communities the user belongs to. Used by the native + Watch "Today" tab.
//
// Response shape: { date, workouts: [{ id, title, description, ..., community }] }
//
// If the user belongs to no communities, or no WOD is published for today,
// returns `{ date, workouts: [] }` so the client can show "No CrossFit
// workout posted for today" rather than treating it as an error.

function parseDateParam(input: string | null): string {
  // Returns YYYY-MM-DD (UTC-anchored to today's local date if no param).
  if (input && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const date = parseDateParam(req.nextUrl.searchParams.get("date"));

  // 1. Communities the user belongs to.
  const memberships = await db
    .select({ communityId: communityMemberships.communityId })
    .from(communityMemberships)
    .where(eq(communityMemberships.userId, user.id));

  const communityIds = memberships.map((m) => m.communityId);

  if (communityIds.length === 0) {
    return NextResponse.json({ date, workouts: [] });
  }

  // 2. Published workouts for today within those communities.
  const rows = await db
    .select({
      workout: workouts,
      community: communities,
    })
    .from(workouts)
    .innerJoin(communities, eq(workouts.communityId, communities.id))
    .where(
      and(
        inArray(workouts.communityId, communityIds),
        eq(workouts.workoutDate, date),
        eq(workouts.published, true),
      ),
    );

  return NextResponse.json({
    date,
    workouts: rows.map((r) => ({
      id: r.workout.id,
      title: r.workout.title,
      description: r.workout.description,
      rawText: r.workout.rawText,
      workoutType: r.workout.workoutType,
      timeCapSeconds: r.workout.timeCapSeconds,
      amrapDurationSeconds: r.workout.amrapDurationSeconds,
      repScheme: r.workout.repScheme,
      rounds: r.workout.rounds,
      workoutDate: r.workout.workoutDate,
      community: {
        id: r.community.id,
        name: r.community.name,
      },
    })),
  });
}
