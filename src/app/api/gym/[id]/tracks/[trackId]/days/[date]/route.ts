// /api/gym/[id]/tracks/[trackId]/days/[date]
//
// PUT    — upsert a single day for a track (spec §1.2).
// DELETE — clear the day. Does not delete a linked workout.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  programmingTrackDays,
  programmingTracks,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";
import {
  upsertTrackDay,
  validateTrackDayUpsertInput,
} from "@/lib/programming/track-day-upserts";

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

async function loadTrackOrError(
  communityId: string,
  trackId: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const [track] = await db
    .select({ id: programmingTracks.id })
    .from(programmingTracks)
    .where(
      and(
        eq(programmingTracks.id, trackId),
        eq(programmingTracks.communityId, communityId)
      )
    )
    .limit(1);
  if (!track) return { ok: false, status: 404, error: "Track not found" };
  return { ok: true };
}

export async function PUT(
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
  const guard = await loadTrackOrError(communityId, trackId);
  if (!guard.ok)
    return NextResponse.json({ error: guard.error }, { status: guard.status });

  const body = await req.json().catch(() => null);
  let input;
  try {
    input = validateTrackDayUpsertInput(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid body" },
      { status: 400 }
    );
  }

  try {
    const day = await db.transaction(async (tx) => {
      return upsertTrackDay(trackId, { date, ...input }, tx);
    });
    return NextResponse.json({ day });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
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
  const guard = await loadTrackOrError(communityId, trackId);
  if (!guard.ok)
    return NextResponse.json({ error: guard.error }, { status: guard.status });

  await db
    .delete(programmingTrackDays)
    .where(
      and(
        eq(programmingTrackDays.trackId, trackId),
        eq(programmingTrackDays.date, date)
      )
    );
  return NextResponse.json({ status: "deleted" });
}
