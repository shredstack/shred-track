// GET /api/gym/[id]/hyrox-workouts?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// PR 3 §3.7 — minimal gym Hyrox programming surface. Lists every
// published session for the gym in the date window where the template's
// workoutType = 'hyrox'. The Hyrox tab renders this above its
// personal-plan flow when the active gym has the hyrox_programming flag
// on.

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { crossfitWorkouts, workoutSessions } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canViewGym } from "@/lib/authz/community";

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: communityId } = await params;
  if (!(await canViewGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to || !isIsoDate(from) || !isIsoDate(to)) {
    return NextResponse.json(
      { error: "from and to are required YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const rows = await db
    .select({
      id: workoutSessions.id,
      // Session title override wins; fall back to template title.
      title: crossfitWorkouts.title,
      sessionTitle: workoutSessions.title,
      description: crossfitWorkouts.description,
      workoutDate: workoutSessions.workoutDate,
      workoutType: crossfitWorkouts.workoutType,
    })
    .from(workoutSessions)
    .innerJoin(
      crossfitWorkouts,
      eq(crossfitWorkouts.id, workoutSessions.crossfitWorkoutId)
    )
    .where(
      and(
        eq(workoutSessions.communityId, communityId),
        eq(crossfitWorkouts.workoutType, "hyrox"),
        eq(workoutSessions.published, true),
        gte(workoutSessions.workoutDate, from),
        lte(workoutSessions.workoutDate, to)
      )
    )
    .orderBy(asc(workoutSessions.workoutDate));

  return NextResponse.json({
    workouts: rows.map((r) => ({
      id: r.id,
      title: r.sessionTitle ?? r.title,
      description: r.description,
      workoutDate: r.workoutDate,
      workoutType: r.workoutType,
    })),
  });
}
