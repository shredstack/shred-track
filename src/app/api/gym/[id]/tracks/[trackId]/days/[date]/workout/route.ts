// POST /api/gym/[id]/tracks/[trackId]/days/[date]/workout
//
// Creates a programmed-day workout for a gym track. Unified schema:
//   1. upsertTemplate (community-scoped) — fingerprint-matches an
//      existing community template or creates a new one.
//   2. createSession — writes a workout_sessions row tied to the gym +
//      date + source track.
//   3. upsertTrackDay — wires the day to the session via
//      workout_sessions.id.
//
// Returns `{ workoutId, trackDayId }`. `workoutId` is the session.id —
// the field name is preserved because the client treats it as an opaque
// identifier (it's what subsequent reads/writes against the workout
// detail page key on).

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { programmingTracks } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";
import {
  upsertTemplate,
  type TemplatePartInput,
} from "@/lib/crossfit/upsert-template";
import { createSession } from "@/lib/crossfit/session-writer";
import { upsertTrackDay } from "@/lib/programming/track-day-upserts";
import type {
  WorkoutSessionScoreType,
} from "@/db/schema";

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function POST(
  req: NextRequest,
  {
    params,
  }: { params: Promise<{ id: string; trackId: string; date: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId, trackId, date } = await params;
  if (!isIsoDate(date))
    return NextResponse.json(
      { error: "date must be YYYY-MM-DD" },
      { status: 400 }
    );
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [track] = await db
    .select()
    .from(programmingTracks)
    .where(
      and(
        eq(programmingTracks.id, trackId),
        eq(programmingTracks.communityId, communityId)
      )
    )
    .limit(1);
  if (!track)
    return NextResponse.json({ error: "Track not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as {
    title?: string | null;
    description?: string | null;
    parts?: TemplatePartInput[];
    isScored?: boolean;
    scoreType?: WorkoutSessionScoreType | null;
    requiresVest?: boolean;
    vestWeightMaleLb?: number | string | null;
    vestWeightFemaleLb?: number | string | null;
    isPartner?: boolean;
    partnerCount?: number | null;
  } | null;
  if (!body || !Array.isArray(body.parts) || body.parts.length === 0) {
    return NextResponse.json(
      { error: "parts[] required" },
      { status: 400 }
    );
  }

  const result = await db.transaction(async (tx) => {
    const firstPart = body.parts![0];
    const upsertResult = await upsertTemplate(tx, {
      title:
        (typeof body.title === "string" && body.title.trim()) ||
        firstPart.label?.trim() ||
        "Untitled workout",
      description: body.description ?? null,
      scope: { kind: "community", communityId },
      workoutType: firstPart.workoutType,
      timeCapSeconds: firstPart.timeCapSeconds ?? null,
      amrapDurationSeconds: firstPart.amrapDurationSeconds ?? null,
      repScheme: firstPart.repScheme ?? null,
      rounds: firstPart.rounds ?? null,
      requiresVest: !!body.requiresVest,
      vestWeightMaleLb: body.vestWeightMaleLb ?? null,
      vestWeightFemaleLb: body.vestWeightFemaleLb ?? null,
      isPartner: !!body.isPartner,
      partnerCount: body.partnerCount ?? null,
      parts: body.parts!,
    });

    const session = await createSession(tx, {
      crossfitWorkoutId: upsertResult.templateId,
      communityId,
      workoutDate: date,
      kind: "wod",
      source: "manual",
      sourceTrackId: trackId,
      published: true,
      isScored: body.isScored ?? true,
      scoreType: body.scoreType ?? null,
    });

    const day = await upsertTrackDay(
      trackId,
      {
        date,
        workoutSessionId: session.id,
        isScored: body.isScored ?? true,
        scoreType: body.scoreType ?? null,
      },
      tx
    );

    return { workoutId: session.id, trackDayId: day.id };
  });

  return NextResponse.json(result, { status: 201 });
}
