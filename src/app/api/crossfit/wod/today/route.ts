// GET /api/crossfit/wod/today
//
// Returns workout sessions scheduled for today (or for ?date=YYYY-MM-DD) —
// both the caller's personal sessions and published sessions from any gym
// they belong to. Used by the native + Watch "Today" tab.
//
// Unified-schema: one row per matching session (not per day). The Watch's
// `loggedByUser` indicator joins scores via workoutSessionId.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  communities,
  communityMemberships,
  crossfitWorkouts,
  scores,
  workoutSessions,
} from "@/db/schema";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

function parseDateParam(input: string | null): string {
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

  const memberships = await db
    .select({ communityId: communityMemberships.communityId })
    .from(communityMemberships)
    .where(
      and(
        eq(communityMemberships.userId, user.id),
        eq(communityMemberships.isActive, true)
      )
    );
  const communityIds = memberships.map((m) => m.communityId);

  // Personal sessions for the user OR published gym sessions from any
  // gym they belong to.
  const personalCond = and(
    eq(workoutSessions.userId, user.id),
    isNull(workoutSessions.communityId)
  );
  const gymCond =
    communityIds.length > 0
      ? and(
          inArray(workoutSessions.communityId, communityIds),
          eq(workoutSessions.published, true)
        )
      : undefined;
  const scopeCond = gymCond ? or(personalCond, gymCond) : personalCond;

  const rows = await db
    .select({
      session: workoutSessions,
      template: crossfitWorkouts,
      community: communities,
    })
    .from(workoutSessions)
    .leftJoin(
      crossfitWorkouts,
      eq(crossfitWorkouts.id, workoutSessions.crossfitWorkoutId)
    )
    .leftJoin(communities, eq(workoutSessions.communityId, communities.id))
    .where(and(eq(workoutSessions.workoutDate, date), scopeCond))
    .orderBy(asc(workoutSessions.position));

  const sessionIds = rows.map((r) => r.session.id);
  const loggedScoreBySessionId = new Map<string, string>();
  if (sessionIds.length > 0) {
    const userScores = await db
      .select({
        id: scores.id,
        workoutSessionId: scores.workoutSessionId,
      })
      .from(scores)
      .where(
        and(
          eq(scores.userId, user.id),
          inArray(scores.workoutSessionId, sessionIds)
        )
      )
      .orderBy(desc(scores.createdAt));
    for (const s of userScores) {
      if (!s.workoutSessionId) continue;
      if (!loggedScoreBySessionId.has(s.workoutSessionId)) {
        loggedScoreBySessionId.set(s.workoutSessionId, s.id);
      }
    }
  }

  return NextResponse.json({
    date,
    workouts: rows.map((r) => {
      const loggedScoreId =
        loggedScoreBySessionId.get(r.session.id) ?? null;
      return {
        id: r.session.id,
        kind: r.session.kind,
        title: r.session.title ?? r.template?.title ?? null,
        description: r.template?.description ?? null,
        rawText: null,
        workoutType: r.template?.workoutType ?? null,
        timeCapSeconds: r.template?.timeCapSeconds ?? null,
        amrapDurationSeconds: r.template?.amrapDurationSeconds ?? null,
        repScheme: r.template?.repScheme ?? null,
        rounds: r.template?.rounds ?? null,
        workoutDate: r.session.workoutDate,
        community: r.community
          ? { id: r.community.id, name: r.community.name }
          : null,
        loggedByUser: loggedScoreId !== null,
        loggedScoreId,
      };
    }),
  });
}
