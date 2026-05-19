// POST /api/gym/[id]/tracks/[trackId]/days/[date]/workout
//
// Creates a new workouts row (linked to the gym + dated to the track day)
// and links it from the track day. Re-uses Smart Builder payload shape
// (`builderPartToPayload()` output). Returns `{ workoutId, trackDayId }`.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { programmingTracks, workouts } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";
import {
  insertWorkoutParts,
  type PartInput,
} from "@/lib/crossfit/insert-workout-parts";
import { upsertTrackDay } from "@/lib/programming/track-day-upserts";

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
    parts?: PartInput[];
    isScored?: boolean;
    scoreType?: string | null;
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
    const [w] = await tx
      .insert(workouts)
      .values({
        createdBy: user.id,
        communityId,
        title: body.title || null,
        description: body.description || null,
        workoutType: firstPart.workoutType,
        timeCapSeconds: firstPart.timeCapSeconds || null,
        amrapDurationSeconds: firstPart.amrapDurationSeconds || null,
        repScheme: firstPart.repScheme || null,
        rounds: firstPart.rounds ?? null,
        workoutDate: date,
        published: true,
        source: "manual",
        requiresVest: !!body.requiresVest,
        vestWeightMaleLb:
          body.vestWeightMaleLb != null
            ? String(body.vestWeightMaleLb)
            : null,
        vestWeightFemaleLb:
          body.vestWeightFemaleLb != null
            ? String(body.vestWeightFemaleLb)
            : null,
        isPartner: !!body.isPartner,
        partnerCount: body.partnerCount ?? null,
      })
      .returning();

    await insertWorkoutParts(tx, {
      workoutId: w.id,
      parts: body.parts!,
    });

    const day = await upsertTrackDay(
      trackId,
      {
        date,
        workoutId: w.id,
        // body stays as-is (let the coach use the free-text tab if they
        // want extra notes alongside structured parts).
        isScored: body.isScored ?? true,
        scoreType: body.scoreType ?? null,
      },
      tx
    );

    return { workoutId: w.id, trackDayId: day.id };
  });

  return NextResponse.json(result, { status: 201 });
}
