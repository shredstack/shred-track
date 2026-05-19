// Centralized upsert path for programming_track_days (spec §1.2).
//
// Both the manual day-editor route and the progression generator call
// into this module so write semantics (idempotency, validation, linked
// workout ownership) stay in lockstep.

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  programmingTrackDays,
  programmingTracks,
  workouts,
} from "@/db/schema";
import type { TrackDayUpsertInput } from "@/types/programming-tracks";

export interface TrackDayUpsert {
  date: string; // YYYY-MM-DD
  body?: string | null;
  workoutId?: string | null;
  isScored?: boolean;
  scoreType?: string | null;
  // Structured prescribed amount (e.g. 40 for "40 sit-ups"). Drives the
  // Mark-done auto-fill on the athlete side. Null on rest days.
  prescribedValue?: number | null;
}

/**
 * Upsert a single day row for a track. Idempotent by (trackId, date).
 * Verifies that any linked workout belongs to the same community as the
 * track. Returns the resulting day row.
 *
 * Designed to run inside an existing transaction — pass `tx`. Falls back
 * to the global `db` if not provided so single-day callers don't need
 * to spin up a transaction just to write one row.
 */
export async function upsertTrackDay(
  trackId: string,
  input: TrackDayUpsert,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx?: any
): Promise<{
  id: string;
  trackId: string;
  date: string;
  body: string | null;
  workoutId: string | null;
  isScored: boolean;
  scoreType: string | null;
}> {
  const executor = tx ?? db;

  // Ownership check: the linked workout must belong to the track's
  // community. We re-query the track each time the workoutId is set so
  // a stale client can't sneak a foreign workout into a track row.
  if (input.workoutId) {
    const [track] = await executor
      .select({ communityId: programmingTracks.communityId })
      .from(programmingTracks)
      .where(eq(programmingTracks.id, trackId))
      .limit(1);
    if (!track) throw new Error("Track not found");

    const [w] = await executor
      .select({ communityId: workouts.communityId })
      .from(workouts)
      .where(eq(workouts.id, input.workoutId))
      .limit(1);
    if (!w) throw new Error("Linked workout not found");
    if (w.communityId !== track.communityId) {
      throw new Error("Workout does not belong to this track's gym");
    }
  }

  const existing = await executor
    .select()
    .from(programmingTrackDays)
    .where(
      and(
        eq(programmingTrackDays.trackId, trackId),
        eq(programmingTrackDays.date, input.date)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    const current = existing[0];
    const patch: Record<string, unknown> = {};
    if (input.body !== undefined) patch.body = input.body;
    if (input.workoutId !== undefined) patch.workoutId = input.workoutId;
    if (input.isScored !== undefined) patch.isScored = input.isScored;
    if (input.scoreType !== undefined) patch.scoreType = input.scoreType;
    if (input.prescribedValue !== undefined) {
      patch.prescribedValue =
        input.prescribedValue == null ? null : String(input.prescribedValue);
    }
    if (Object.keys(patch).length === 0) {
      return current;
    }
    const [updated] = await executor
      .update(programmingTrackDays)
      .set(patch)
      .where(eq(programmingTrackDays.id, current.id))
      .returning();
    return updated;
  }

  const [created] = await executor
    .insert(programmingTrackDays)
    .values({
      trackId,
      date: input.date,
      body: input.body ?? null,
      workoutId: input.workoutId ?? null,
      isScored: input.isScored ?? true,
      scoreType: input.scoreType ?? null,
      prescribedValue:
        input.prescribedValue == null ? null : String(input.prescribedValue),
    })
    .returning();
  return created;
}

/**
 * Bulk upsert helper used by the progression generator. Wraps each
 * upsert in the shared transaction `tx` so the entire generate-from-
 * progression call is atomic.
 *
 * Returns the count of rows that were updated vs created vs skipped.
 */
export async function bulkUpsertTrackDays(
  trackId: string,
  rows: Array<TrackDayUpsert & { skipIfReviewed?: boolean }>,
  options: { overwriteReviewed?: boolean } = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx?: any
): Promise<{ generated: number; skipped: number }> {
  const executor = tx ?? db;
  let generated = 0;
  let skipped = 0;
  for (const row of rows) {
    const [existing] = await executor
      .select()
      .from(programmingTrackDays)
      .where(
        and(
          eq(programmingTrackDays.trackId, trackId),
          eq(programmingTrackDays.date, row.date)
        )
      )
      .limit(1);

    // Overwrite policy: skip days that look already-reviewed unless the
    // caller explicitly opted into overwriting them.
    if (existing && !options.overwriteReviewed) {
      const looksReviewed =
        existing.workoutId != null ||
        (existing.body != null && existing.body.trim().length > 0);
      if (looksReviewed) {
        skipped += 1;
        continue;
      }
    }
    await upsertTrackDay(trackId, row, tx);
    generated += 1;
  }
  return { generated, skipped };
}

/** Validates input to `TrackDayUpsertInput` shape. Throws on invalid. */
export function validateTrackDayUpsertInput(
  body: unknown
): TrackDayUpsertInput {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid body");
  }
  const b = body as Record<string, unknown>;
  const result: TrackDayUpsertInput = {};
  if (b.body !== undefined) {
    if (b.body !== null && typeof b.body !== "string") {
      throw new Error("body must be string or null");
    }
    result.body = b.body as string | null;
  }
  if (b.workoutId !== undefined) {
    if (b.workoutId !== null && typeof b.workoutId !== "string") {
      throw new Error("workoutId must be string or null");
    }
    result.workoutId = b.workoutId as string | null;
  }
  if (b.isScored !== undefined) {
    if (typeof b.isScored !== "boolean") {
      throw new Error("isScored must be boolean");
    }
    result.isScored = b.isScored;
  }
  if (b.scoreType !== undefined) {
    const valid = new Set([
      "time",
      "rounds",
      "reps",
      "weight",
      "no_score",
      null,
    ]);
    if (!valid.has(b.scoreType as never)) {
      throw new Error("scoreType invalid");
    }
    result.scoreType = b.scoreType as TrackDayUpsertInput["scoreType"];
  }
  return result;
}
