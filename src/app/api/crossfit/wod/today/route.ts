import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  workouts,
  communityMemberships,
  communities,
  scores,
} from "@/db/schema";
import { eq, and, or, inArray, isNull, desc } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// GET /api/crossfit/wod/today
//
// Returns workouts scheduled for today (or for ?date=YYYY-MM-DD) — both the
// caller's personal workouts and published WODs from any gym they belong to.
// Used by the native + Watch "Today" tab.
//
// Response shape: { date, workouts: [{ id, title, description, ..., community }] }
// `community` is null for personal workouts.
//
// If nothing is scheduled for today, returns `{ date, workouts: [] }`.

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

  // 1. Communities the user is an active member of. Inactive memberships
  // (left the gym, removed) shouldn't see that gym's programming.
  const memberships = await db
    .select({ communityId: communityMemberships.communityId })
    .from(communityMemberships)
    .where(
      and(
        eq(communityMemberships.userId, user.id),
        eq(communityMemberships.isActive, true),
      ),
    );

  const communityIds = memberships.map((m) => m.communityId);

  // 2. Workouts for today — personal (createdBy=user, no community) plus
  // published gym workouts from any community the user belongs to. The
  // `published` filter only applies to gym workouts; personal workouts
  // default to published=false and shouldn't be hidden from their author.
  const personalCond = and(
    eq(workouts.createdBy, user.id),
    isNull(workouts.communityId),
  );
  const gymCond =
    communityIds.length > 0
      ? and(
          inArray(workouts.communityId, communityIds),
          eq(workouts.published, true),
        )
      : undefined;
  const scopeCond = gymCond ? or(personalCond, gymCond) : personalCond;

  const rows = await db
    .select({
      workout: workouts,
      community: communities,
    })
    .from(workouts)
    .leftJoin(communities, eq(workouts.communityId, communities.id))
    .where(and(eq(workouts.workoutDate, date), scopeCond));

  // 3. Per-user logged state — map workoutId → most-recent score for the user.
  // Used by the Watch's "logged ✓" indicator and the midday nudge suppression.
  const workoutIds = rows.map((r) => r.workout.id);
  const scoresByWorkoutId = new Map<string, string>();
  if (workoutIds.length > 0) {
    const userScores = await db
      .select({ id: scores.id, workoutId: scores.workoutId })
      .from(scores)
      .where(
        and(
          eq(scores.userId, user.id),
          inArray(scores.workoutId, workoutIds),
        ),
      )
      .orderBy(desc(scores.createdAt));
    for (const s of userScores) {
      // First (most recent) score wins thanks to the desc order.
      if (!scoresByWorkoutId.has(s.workoutId)) {
        scoresByWorkoutId.set(s.workoutId, s.id);
      }
    }
  }

  return NextResponse.json({
    date,
    workouts: rows.map((r) => {
      const loggedScoreId = scoresByWorkoutId.get(r.workout.id) ?? null;
      return {
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
        community: r.community
          ? { id: r.community.id, name: r.community.name }
          : null,
        loggedByUser: loggedScoreId !== null,
        loggedScoreId,
      };
    }),
  });
}
