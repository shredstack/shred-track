// GET /api/gym/[id]/today-workout
//
// Returns the published workout for today in the gym's timezone, or nulls.
// Used by the social composer's "link to today's WOD" toggle.

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { communities, workouts } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canViewGym } from "@/lib/authz/community";
import { resolveGymTimezone } from "@/lib/timezone";

function todayInTz(tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId } = await params;
  if (!(await canViewGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const [c] = await db
    .select({ tz: communities.gymTimezone })
    .from(communities)
    .where(eq(communities.id, communityId))
    .limit(1);
  const today = todayInTz(resolveGymTimezone(c?.tz));
  const [w] = await db
    .select({
      workoutId: workouts.id,
      title: workouts.title,
      workoutDate: workouts.workoutDate,
    })
    .from(workouts)
    .where(
      and(
        eq(workouts.communityId, communityId),
        eq(workouts.workoutDate, today),
        eq(workouts.published, true)
      )
    )
    .orderBy(desc(workouts.updatedAt))
    .limit(1);
  return NextResponse.json(
    w ?? { workoutId: null, title: null, workoutDate: null }
  );
}
