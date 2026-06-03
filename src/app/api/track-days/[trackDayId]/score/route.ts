// /api/track-days/[trackDayId]/score
//
// Per-day numeric score for non-WOD track days (spec §3.5). NOT scoped
// under /api/gym/[id] because the athlete isn't necessarily a gym admin —
// authorization is by gym membership of the track's community.
//
// GET    — return the current user's score for this day, or null.
// PUT    — upsert (numericValue / textValue / isComplete / notes).
// DELETE — remove the row.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  programmingTrackDays,
  programmingTrackParticipations,
  programmingTracks,
  trackDayScores,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canViewGym } from "@/lib/authz/community";
import type { TrackScoringConfig } from "@/types/programming-tracks";

async function loadTrackDayContext(
  trackDayId: string,
  userId: string
): Promise<
  | {
      ok: true;
      track: {
        id: string;
        communityId: string;
        status: string;
        displayMode: string;
        scoringConfig: unknown;
      };
      day: { id: string; isScored: boolean };
      requiresOptIn: boolean;
      isOptedIn: boolean;
    }
  | { ok: false; status: number; error: string }
> {
  const [day] = await db
    .select({
      id: programmingTrackDays.id,
      trackId: programmingTrackDays.trackId,
      isScored: programmingTrackDays.isScored,
    })
    .from(programmingTrackDays)
    .where(eq(programmingTrackDays.id, trackDayId))
    .limit(1);
  if (!day) return { ok: false, status: 404, error: "Track day not found" };
  const [track] = await db
    .select({
      id: programmingTracks.id,
      communityId: programmingTracks.communityId,
      status: programmingTracks.status,
      displayMode: programmingTracks.displayMode,
      scoringConfig: programmingTracks.scoringConfig,
    })
    .from(programmingTracks)
    .where(eq(programmingTracks.id, day.trackId))
    .limit(1);
  if (!track)
    return { ok: false, status: 404, error: "Parent track not found" };

  if (!(await canViewGym(userId, track.communityId))) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  const requiresOptIn =
    track.displayMode === "standalone" ||
    track.displayMode === "inline_and_standalone";
  let isOptedIn = !requiresOptIn;
  if (requiresOptIn) {
    const [part] = await db
      .select({ id: programmingTrackParticipations.id })
      .from(programmingTrackParticipations)
      .where(
        and(
          eq(programmingTrackParticipations.trackId, track.id),
          eq(programmingTrackParticipations.userId, userId)
        )
      )
      .limit(1);
    isOptedIn = !!part;
  }

  return { ok: true, track, day, requiresOptIn, isOptedIn };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ trackDayId: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { trackDayId } = await params;

  const ctx = await loadTrackDayContext(trackDayId, user.id);
  if (!ctx.ok)
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const [row] = await db
    .select()
    .from(trackDayScores)
    .where(
      and(
        eq(trackDayScores.trackDayId, trackDayId),
        eq(trackDayScores.userId, user.id)
      )
    )
    .limit(1);
  return NextResponse.json({ score: row ?? null });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ trackDayId: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { trackDayId } = await params;

  const ctx = await loadTrackDayContext(trackDayId, user.id);
  if (!ctx.ok)
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (ctx.track.status !== "active") {
    return NextResponse.json(
      { error: "Track is not active" },
      { status: 400 }
    );
  }
  if (ctx.requiresOptIn && !ctx.isOptedIn) {
    return NextResponse.json(
      { error: "You haven't joined this track" },
      { status: 403 }
    );
  }
  if (!ctx.day.isScored) {
    return NextResponse.json(
      { error: "This day is not scored (rest day)" },
      { status: 400 }
    );
  }

  const body = (await req.json().catch(() => null)) as {
    numericValue?: number | string | null;
    textValue?: string | null;
    isComplete?: boolean;
    notes?: string | null;
  } | null;
  if (!body)
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const config = (ctx.track.scoringConfig ?? null) as TrackScoringConfig | null;

  let numericValue: string | null = null;
  if (body.numericValue !== undefined && body.numericValue !== null) {
    const n =
      typeof body.numericValue === "number"
        ? body.numericValue
        : Number(body.numericValue);
    if (!Number.isFinite(n)) {
      return NextResponse.json(
        { error: "numericValue must be a number" },
        { status: 400 }
      );
    }
    numericValue = String(n);
  }

  // textValue carries the tile-state JSON for per-day sets challenges
  // (spec §5.2): `{"sets":[6,4,3,3]}`. We validate non-negative integers
  // when the JSON parses; extra fields are ignored so older clients can
  // round-trip a value they don't understand. Bodies that aren't JSON
  // (or aren't an object) are accepted as-is — `textValue` is also a
  // general-purpose free-text column.
  if (typeof body.textValue === "string" && body.textValue.trim()) {
    if (body.textValue.length > 8192) {
      return NextResponse.json(
        { error: "textValue exceeds 8KB limit" },
        { status: 400 }
      );
    }
    try {
      const parsed = JSON.parse(body.textValue);
      if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { sets?: unknown }).sets)
      ) {
        const sets = (parsed as { sets: unknown[] }).sets;
        const ok = sets.every(
          (s) => typeof s === "number" && Number.isInteger(s) && s >= 0
        );
        if (!ok) {
          return NextResponse.json(
            { error: "textValue.sets must be non-negative integers" },
            { status: 400 }
          );
        }
      }
    } catch {
      // Not JSON — leave as-is.
    }
  }

  // If the scoring config doesn't allow "just done" and the athlete sent
  // no numeric value, require one — otherwise this is just a no-op tap.
  const allowJustDone = config?.allowJustDone === true;
  if (!allowJustDone && numericValue === null && !body.textValue) {
    return NextResponse.json(
      { error: "numericValue is required" },
      { status: 400 }
    );
  }

  const unit = config?.unit
    ? config.unit === "custom"
      ? config.unitLabel ?? "custom"
      : config.unit
    : null;

  const [row] = await db
    .insert(trackDayScores)
    .values({
      trackDayId,
      userId: user.id,
      numericValue,
      textValue: body.textValue ?? null,
      unit,
      isComplete: body.isComplete ?? true,
      notes: body.notes ?? null,
    })
    .onConflictDoUpdate({
      target: [trackDayScores.trackDayId, trackDayScores.userId],
      set: {
        numericValue,
        textValue: body.textValue ?? null,
        unit,
        isComplete: body.isComplete ?? true,
        notes: body.notes ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return NextResponse.json({ score: row });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ trackDayId: string }> }
) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { trackDayId } = await params;

  const ctx = await loadTrackDayContext(trackDayId, user.id);
  if (!ctx.ok)
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  await db
    .delete(trackDayScores)
    .where(
      and(
        eq(trackDayScores.trackDayId, trackDayId),
        eq(trackDayScores.userId, user.id)
      )
    );
  return NextResponse.json({ status: "deleted" });
}
