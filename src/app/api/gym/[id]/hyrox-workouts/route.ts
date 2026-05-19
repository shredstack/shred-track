// GET /api/gym/[id]/hyrox-workouts?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// PR 3 §3.7 — minimal gym Hyrox programming surface. Lists every
// published workout for the gym in the date window where workoutType =
// 'hyrox'. The Hyrox tab renders this above its personal-plan flow
// when the active gym has the hyrox_programming flag on.

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { workouts } from "@/db/schema";
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
      id: workouts.id,
      title: workouts.title,
      description: workouts.description,
      workoutDate: workouts.workoutDate,
      workoutType: workouts.workoutType,
    })
    .from(workouts)
    .where(
      and(
        eq(workouts.communityId, communityId),
        eq(workouts.workoutType, "hyrox"),
        eq(workouts.published, true),
        gte(workouts.workoutDate, from),
        lte(workouts.workoutDate, to)
      )
    )
    .orderBy(asc(workouts.workoutDate));

  return NextResponse.json({ workouts: rows });
}
