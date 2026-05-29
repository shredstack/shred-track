// GET /api/gym/[id]/today-workout
//
// Returns the published session for today in the gym's timezone, or nulls.
// Used by the social composer's "link to today's WOD" toggle.
//
// Unified-schema: pulls the first published WOD-kind session for the day.
// The returned `workoutId` is a session id (the day-level handle the UI
// uses after the cutover).

import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  communities,
  crossfitWorkouts,
  workoutSessions,
} from "@/db/schema";
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

  // Prefer a WOD-kind session; fall back to the first session of the day.
  // Title comes from the session's template when present.
  const [w] = await db
    .select({
      workoutId: workoutSessions.id,
      sessionTitle: workoutSessions.title,
      templateTitle: crossfitWorkouts.title,
      workoutDate: workoutSessions.workoutDate,
      position: workoutSessions.position,
      kind: workoutSessions.kind,
    })
    .from(workoutSessions)
    .leftJoin(
      crossfitWorkouts,
      eq(crossfitWorkouts.id, workoutSessions.crossfitWorkoutId)
    )
    .where(
      and(
        eq(workoutSessions.communityId, communityId),
        eq(workoutSessions.workoutDate, today),
        eq(workoutSessions.published, true)
      )
    )
    .orderBy(
      // wod kind first; then earliest position; then most recent update.
      desc(eq(workoutSessions.kind, "wod")),
      asc(workoutSessions.position),
      desc(workoutSessions.updatedAt)
    )
    .limit(1);

  if (!w) {
    return NextResponse.json({
      workoutId: null,
      title: null,
      workoutDate: null,
    });
  }
  return NextResponse.json({
    workoutId: w.workoutId,
    title: w.sessionTitle ?? w.templateTitle ?? null,
    workoutDate: w.workoutDate,
  });
}
