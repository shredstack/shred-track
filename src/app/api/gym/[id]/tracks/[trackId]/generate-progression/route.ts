// POST /api/gym/[id]/tracks/[trackId]/generate-progression
//
// Runs the progression generator (spec §2.2) and upserts the resulting
// day rows. By default skips days that look already-reviewed (linked
// workout or non-empty body). Pass `overwriteReviewed: true` to clobber.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { programmingTracks } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";
import {
  generateProgression,
  type DayOfWeek,
  type ProgressionInput,
  type RestCadence,
} from "@/lib/programming/progression-generator";
import { bulkUpsertTrackDays } from "@/lib/programming/track-day-upserts";

const VALID_REST_CADENCE = new Set<RestCadence>([
  "none",
  "everyN",
  "daysOfWeek",
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; trackId: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId, trackId } = await params;
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

  const body = (await req.json().catch(() => null)) as
    | (Omit<ProgressionInput, "startsOn" | "endsOn"> & {
        overwriteReviewed?: boolean;
      })
    | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!VALID_REST_CADENCE.has(body.restCadence)) {
    return NextResponse.json(
      { error: "Invalid restCadence" },
      { status: 400 }
    );
  }
  if (
    body.scoreType !== "reps" &&
    body.scoreType !== "no_score"
  ) {
    return NextResponse.json(
      { error: "scoreType must be 'reps' or 'no_score'" },
      { status: 400 }
    );
  }

  const input: ProgressionInput = {
    startsOn: track.startsOn,
    endsOn: track.endsOn,
    movement: body.movement,
    startReps: body.startReps,
    dailyIncrement: body.dailyIncrement,
    restCadence: body.restCadence,
    restEveryN: body.restEveryN,
    restDaysOfWeek: body.restDaysOfWeek as DayOfWeek[] | undefined,
    capReps: body.capReps,
    scoreType: body.scoreType,
    format: body.format,
    restDayLabel: body.restDayLabel,
  };

  let outputs;
  try {
    outputs = generateProgression(input);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid input" },
      { status: 400 }
    );
  }

  const result = await db.transaction(async (tx) => {
    return bulkUpsertTrackDays(
      trackId,
      outputs.map((o) => ({
        date: o.date,
        body: o.body,
        isScored: o.isScored,
        scoreType: o.scoreType,
        prescribedValue: o.reps,
      })),
      { overwriteReviewed: body.overwriteReviewed === true },
      tx
    );
  });

  return NextResponse.json(result);
}
