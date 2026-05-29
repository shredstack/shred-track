// POST /api/gym/[id]/programming/sections/from-workout
//
// Move a manual CrossFit-tab session into the day's programming as a new
// section of the chosen kind. In the unified schema this collapses to a
// one-line scope swap: the source `workout_sessions` row keeps its
// template + scores; we just flip its `user_id` to null, set `community_id`
// + `position` + `kind`. No prescription copy, no metadata copy.
//
// Body: { sourceWorkoutId, kind, workoutDate (YYYY-MM-DD) }.
// `sourceWorkoutId` is a `workout_sessions.id` post-cutover.
// Coach/admin only.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  WORKOUT_SESSION_KINDS,
  programmingReleases,
  workoutSessions,
  type WorkoutSessionKind,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";
import {
  nextPositionForDay,
  updateSession,
} from "@/lib/crossfit/session-writer";

function isValidKind(v: unknown): v is WorkoutSessionKind {
  return (
    typeof v === "string" &&
    (WORKOUT_SESSION_KINDS as readonly string[]).includes(v)
  );
}

function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: communityId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    sourceWorkoutId?: string;
    kind?: string;
    workoutDate?: string;
  } | null;

  if (!body?.sourceWorkoutId) {
    return NextResponse.json(
      { error: "sourceWorkoutId is required" },
      { status: 400 }
    );
  }
  if (!isValidKind(body.kind)) {
    return NextResponse.json(
      { error: "A valid kind is required" },
      { status: 400 }
    );
  }
  const workoutDate = body.workoutDate;
  if (!workoutDate || !/^\d{4}-\d{2}-\d{2}$/.test(workoutDate)) {
    return NextResponse.json(
      { error: "workoutDate (YYYY-MM-DD) is required" },
      { status: 400 }
    );
  }

  const [source] = await db
    .select({
      id: workoutSessions.id,
      userId: workoutSessions.userId,
      communityId: workoutSessions.communityId,
      workoutDate: workoutSessions.workoutDate,
      crossfitWorkoutId: workoutSessions.crossfitWorkoutId,
      programmingReleaseId: workoutSessions.programmingReleaseId,
    })
    .from(workoutSessions)
    .where(eq(workoutSessions.id, body.sourceWorkoutId))
    .limit(1);
  if (!source) {
    return NextResponse.json(
      { error: "Workout not found" },
      { status: 404 }
    );
  }
  // Two flows land here:
  //   • Personal log → gym programming (the legacy "move into gym" path).
  //   • Gym-manual workout → gym programming (the manual-workouts banner's
  //     "Move into programming" button, surfaced now that the programming
  //     route buckets manual sessions separately).
  // We accept either, but a session that's already attached to a release
  // is double-promotion and should bounce.
  if (source.programmingReleaseId) {
    return NextResponse.json(
      { error: "Workout is already part of programming" },
      { status: 400 }
    );
  }
  // A gym-scoped source must belong to THIS gym. Cross-gym moves aren't
  // an authorized flow — admins of gym A can't reach into gym B's manual
  // workouts.
  if (source.communityId !== null && source.communityId !== communityId) {
    return NextResponse.json(
      { error: "Workout belongs to a different gym" },
      { status: 403 }
    );
  }
  if (source.workoutDate !== workoutDate) {
    return NextResponse.json(
      { error: "Source workout's date does not match the target date" },
      { status: 400 }
    );
  }
  // Personal sessions move only when the caller owns them. Gym-manual
  // sessions are owned by the gym; canManageGym above is the authz check.
  if (source.communityId === null && source.userId !== user.id) {
    return NextResponse.json(
      { error: "You can only move your own workouts" },
      { status: 403 }
    );
  }

  const kind = body.kind;

  try {
    const result = await db.transaction(async (tx) => {
      // Find or create the draft release covering the date.
      const monday = mondayOf(workoutDate);
      const [release] = await tx
        .select({ id: programmingReleases.id })
        .from(programmingReleases)
        .where(
          and(
            eq(programmingReleases.communityId, communityId),
            eq(programmingReleases.weekStart, monday)
          )
        )
        .limit(1);
      let releaseId: string;
      if (release) {
        releaseId = release.id;
      } else {
        const [r] = await tx
          .insert(programmingReleases)
          .values({
            communityId,
            weekStart: monday,
            status: "draft",
            source: "manual",
          })
          .returning({ id: programmingReleases.id });
        releaseId = r.id;
      }

      const position = await nextPositionForDay(tx, {
        communityId,
        workoutDate,
      });

      // The one-line scope swap. The session keeps its
      // crossfit_workout_id (template); the existing scores stay
      // attached via workout_session_id; no rows move around.
      const updated = await updateSession(tx, source.id, {
        userId: null,
        communityId,
        kind,
        position,
        programmingReleaseId: releaseId,
        reviewedAt: new Date(),
      });

      return {
        sectionId: source.id,
        crossfitWorkoutId: updated?.crossfitWorkoutId ?? null,
        programmingReleaseId: releaseId,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to move workout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
