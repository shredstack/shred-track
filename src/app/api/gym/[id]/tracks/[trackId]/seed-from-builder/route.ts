// POST /api/gym/[id]/tracks/[trackId]/seed-from-builder
//
// Spec §5.1. Rebuilds every day in `[track.startsOn, track.endsOn]` from
// a structured Builder payload. Writes:
//   1. programming_tracks.scoring_config (with builderPattern + restCadence
//      so Re-run Builder can reproduce the same skip days).
//   2. programming_track_days (body + prescribedValue), one per date in
//      the range.
//   3. workout_sessions for any free-text day on an active track, via the
//      existing syncFreeTextTrackDaySession helper — so the per-day input
//      surfaces on the athlete CrossFit tab the moment seed completes.
//
// Wrapped in a single db.transaction so a half-seeded track is never
// visible to the athlete-facing reader.

import { NextRequest, NextResponse } from "next/server";
import { and, eq, notInArray } from "drizzle-orm";
import { db } from "@/db";
import {
  programmingTrackDays,
  programmingTracks,
  workoutSessions,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { canManageGym } from "@/lib/authz/community";
import {
  generateBuilderDays,
  patternToBuilderPattern,
  type BuilderPattern,
} from "@/lib/programming/challenge-builder";
import { upsertTrackDay } from "@/lib/programming/track-day-upserts";
import { syncFreeTextTrackDaySession } from "@/lib/programming/track-day-session-sync";
import {
  TRACK_BUILDER_MARK_DONE_STYLES,
  TRACK_BUILDER_REST_CADENCES,
  TRACK_SCORING_AGGREGATIONS,
  TRACK_SCORING_UNITS,
  type TrackBuilderMarkDoneStyle,
  type TrackBuilderRestCadence,
  type TrackScoringAggregation,
  type TrackScoringConfig,
  type TrackScoringUnit,
} from "@/types/programming-tracks";

interface BuilderRequestBody {
  pattern: BuilderPattern;
  unit: TrackScoringUnit;
  unitLabel?: string;
  label: string;
  restCadence: TrackBuilderRestCadence;
  restDayLabel?: string;
  markDoneStyle: TrackBuilderMarkDoneStyle;
  aggregation: TrackScoringAggregation;
  description?: string;
  dailyTarget?: number;
}

function validateBody(raw: unknown): BuilderRequestBody | string {
  if (!raw || typeof raw !== "object") return "Invalid body";
  const b = raw as Record<string, unknown>;
  if (typeof b.label !== "string" || !b.label.trim()) {
    return "label is required";
  }
  if (
    typeof b.unit !== "string" ||
    !TRACK_SCORING_UNITS.includes(b.unit as TrackScoringUnit)
  ) {
    return "Invalid unit";
  }
  if (
    typeof b.restCadence !== "string" ||
    !TRACK_BUILDER_REST_CADENCES.includes(b.restCadence as TrackBuilderRestCadence)
  ) {
    return "Invalid restCadence";
  }
  if (
    typeof b.markDoneStyle !== "string" ||
    !TRACK_BUILDER_MARK_DONE_STYLES.includes(
      b.markDoneStyle as TrackBuilderMarkDoneStyle
    )
  ) {
    return "Invalid markDoneStyle";
  }
  if (
    typeof b.aggregation !== "string" ||
    !TRACK_SCORING_AGGREGATIONS.includes(b.aggregation as TrackScoringAggregation)
  ) {
    return "Invalid aggregation";
  }
  if (!b.pattern || typeof b.pattern !== "object") {
    return "Invalid pattern";
  }
  const p = b.pattern as { kind?: string };
  if (p.kind !== "flat" && p.kind !== "ladder" && p.kind !== "per_day") {
    return "Invalid pattern.kind";
  }
  return {
    pattern: b.pattern as BuilderPattern,
    unit: b.unit as TrackScoringUnit,
    unitLabel:
      typeof b.unitLabel === "string" ? b.unitLabel.trim() || undefined : undefined,
    label: b.label.trim(),
    restCadence: b.restCadence as TrackBuilderRestCadence,
    restDayLabel:
      typeof b.restDayLabel === "string"
        ? b.restDayLabel.trim() || undefined
        : undefined,
    markDoneStyle: b.markDoneStyle as TrackBuilderMarkDoneStyle,
    aggregation: b.aggregation as TrackScoringAggregation,
    description:
      typeof b.description === "string"
        ? b.description.trim() || undefined
        : undefined,
    dailyTarget:
      typeof b.dailyTarget === "number" && Number.isFinite(b.dailyTarget)
        ? b.dailyTarget
        : undefined,
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; trackId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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
  if (!track) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = validateBody(raw);
  if (typeof parsed === "string") {
    return NextResponse.json({ error: parsed }, { status: 400 });
  }

  let outputs;
  try {
    outputs = generateBuilderDays({
      startsOn: track.startsOn,
      endsOn: track.endsOn,
      label: parsed.label,
      pattern: parsed.pattern,
      restCadence: parsed.restCadence,
      restDayLabel: parsed.restDayLabel,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid input" },
      { status: 400 }
    );
  }

  const allowJustDone =
    parsed.markDoneStyle === "prefilled" ||
    parsed.markDoneStyle === "checkbox";
  const scoringConfig: TrackScoringConfig = {
    unit: parsed.unit,
    aggregation: parsed.aggregation,
    ...(parsed.unitLabel ? { unitLabel: parsed.unitLabel } : {}),
    ...(parsed.dailyTarget != null ? { dailyTarget: parsed.dailyTarget } : {}),
    ...(allowJustDone ? { allowJustDone: true } : {}),
    ...(parsed.markDoneStyle === "checkbox" ? { checkboxOnly: true } : {}),
    ...(parsed.description ? { description: parsed.description } : {}),
    builderPattern: patternToBuilderPattern(parsed.pattern),
    restCadence: parsed.restCadence,
    ...(parsed.restDayLabel ? { restDayLabel: parsed.restDayLabel } : {}),
  };

  // Map the score type for scored days. We surface as "reps" when the
  // unit fits the rep family; otherwise leave null so the per-day input
  // doesn't render a WOD-style score block.
  const scoreType: string | null =
    parsed.unit === "reps" || parsed.unit === "count" ? "reps" : null;

  const result = await db.transaction(async (tx) => {
    const [updatedTrack] = await tx
      .update(programmingTracks)
      .set({ scoringConfig, updatedAt: new Date() })
      .where(eq(programmingTracks.id, trackId))
      .returning();

    // Always overwrite — Builder is "rebuild every day from this pattern",
    // not "skip already-edited days". Per-day overrides are an explicit
    // post-Builder step in the day editor.
    let written = 0;
    for (const o of outputs) {
      const day = await upsertTrackDay(
        trackId,
        {
          date: o.date,
          body: o.body,
          isScored: o.isScored,
          scoreType: o.isScored ? scoreType : null,
          prescribedValue: o.prescribedValue,
        },
        tx
      );
      // Materialize sessions for free-text days on an active track so the
      // CrossFit tab picks them up immediately. The helper no-ops when
      // status !== active.
      await syncFreeTextTrackDaySession(tx, {
        track: updatedTrack,
        day: {
          id: day.id,
          date: day.date,
          body: day.body,
          workoutSessionId: day.workoutSessionId,
          isScored: day.isScored,
          scoreType: day.scoreType,
        },
      });
      written += 1;
    }

    // Soft cleanup: drop any track-day rows that fell outside the new
    // generated set (e.g. the admin shortened the window or shifted the
    // rest cadence) AND any workout_sessions sourced from this track on
    // those same dates. Without the session delete, Re-run Builder on an
    // active track would leave orphaned sessions visible on the CrossFit
    // tab for dates that no longer have a backing track day — the
    // publish-state flip on track PUT only fires when status changes,
    // which doesn't happen here.
    const keepDates = outputs.map((o) => o.date);
    if (keepDates.length > 0) {
      await tx
        .delete(programmingTrackDays)
        .where(
          and(
            eq(programmingTrackDays.trackId, trackId),
            notInArray(programmingTrackDays.date, keepDates)
          )
        );
      await tx
        .delete(workoutSessions)
        .where(
          and(
            eq(workoutSessions.sourceTrackId, trackId),
            notInArray(workoutSessions.workoutDate, keepDates)
          )
        );
    }

    return { written };
  });

  return NextResponse.json({
    written: result.written,
    scoringConfig,
  });
}
