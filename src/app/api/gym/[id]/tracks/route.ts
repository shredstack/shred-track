// /api/gym/[id]/tracks
//
// GET: list tracks for a gym. Coach/admin only.
// POST: create a track + optionally upsert days from raw text.

import { NextRequest, NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import { db } from "@/db";
import {
  programmingTracks,
  programmingTrackDays,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";
import { attachDates, parseTrackDays } from "@/lib/track-day-parser";

const VALID_KINDS = new Set([
  "cap",
  "monthly_challenge",
  "event_prep",
  "custom",
]);
const VALID_DISPLAY = new Set([
  "inline",
  "standalone",
  "inline_and_standalone",
]);
const VALID_INLINE_POS = new Set([
  "top",
  "after_wod",
  "before_stretching",
  "before_at_home",
  "end_of_day",
]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const rows = await db
    .select()
    .from(programmingTracks)
    .where(eq(programmingTracks.communityId, communityId))
    .orderBy(asc(programmingTracks.startsOn));
  return NextResponse.json({ tracks: rows });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: communityId } = await params;
  if (!(await canManageGym(user.id, communityId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (
    !body ||
    !VALID_KINDS.has(body.kind) ||
    !VALID_DISPLAY.has(body.displayMode) ||
    !body.name ||
    !body.startsOn ||
    !body.endsOn
  ) {
    return NextResponse.json({ error: "Missing/invalid fields" }, { status: 400 });
  }
  if (body.inlinePosition && !VALID_INLINE_POS.has(body.inlinePosition)) {
    return NextResponse.json({ error: "Invalid inlinePosition" }, { status: 400 });
  }

  const track = await db.transaction(async (tx) => {
    const [t] = await tx
      .insert(programmingTracks)
      .values({
        communityId,
        kind: body.kind,
        name: body.name,
        description: body.description ?? null,
        startsOn: body.startsOn,
        endsOn: body.endsOn,
        displayMode: body.displayMode,
        inlinePosition: body.inlinePosition ?? null,
        optInRequired:
          body.optInRequired === true ||
          body.displayMode === "standalone" ||
          body.kind === "event_prep",
        scoringConfig: body.scoringConfig ?? null,
        status: body.status ?? "active",
      })
      .returning();
    if (typeof body.daysText === "string" && body.daysText.trim()) {
      const parsed = parseTrackDays(body.daysText);
      const withDates = attachDates(parsed, body.startsOn);
      if (withDates.length) {
        await tx.insert(programmingTrackDays).values(
          withDates.map((d) => ({
            trackId: t.id,
            date: d.date,
            body: d.body,
            isScored: body.isScored === false ? false : true,
            scoreType: body.scoreType ?? null,
          }))
        );
      }
    }
    return t;
  });
  return NextResponse.json(track, { status: 201 });
}
