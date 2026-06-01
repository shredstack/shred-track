// Free-text → workout_sessions sync for a single track day.
//
// Smart-builder days create their session inline in the workout POST.
// Free-text days only write to programming_track_days, so members don't
// see them until the publish injector runs against that week. That
// injector is gated on the gym having already published programming for
// the week, so manually-activated tracks (e.g. a monthly challenge
// added between releases) get stuck invisible.
//
// This helper closes the gap by syncing a free-text day to a
// body-only workout_sessions row whenever the track is active. Re-runs
// safely: it updates the existing session row instead of inserting a
// duplicate on subsequent edits.

import { and, eq } from "drizzle-orm";
import {
  programmingTrackDays,
  programmingTracks,
  workoutSessions,
  type ProgrammingTrack,
} from "@/db/schema";
import {
  resolveInlinePosition,
  type InlinePosition,
} from "@/lib/programming/track-position";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

interface TrackDayRowMinimal {
  id: string;
  date: string;
  body: string | null;
  workoutSessionId: string | null;
  isScored: boolean;
  scoreType: string | null;
}

/**
 * Ensure a workout_sessions row exists for a free-text track day on an
 * active track, or update the existing one to match the latest day
 * body. No-op when the track is draft/archived (members shouldn't see
 * anything) or when the day already has a smart-builder linked session
 * (that flow owns the session lifecycle).
 *
 * Returns the resulting session id, or null when no session was needed.
 */
export async function syncFreeTextTrackDaySession(
  tx: Tx,
  opts: {
    track: ProgrammingTrack;
    day: TrackDayRowMinimal;
  }
): Promise<string | null> {
  const { track, day } = opts;
  if (!track.communityId) return null;

  const body = (day.body ?? "").trim();
  const sectionKind: "monthly_challenge" | "custom" =
    track.kind === "monthly_challenge" ? "monthly_challenge" : "custom";
  const insertPosition = (track.inlinePosition ??
    "end_of_day") as InlinePosition;
  const shouldExist = body.length > 0 && track.status === "active";

  // If the day already has a linked session, find it and either update
  // it (still free-text, body changed) or leave it alone (smart-builder
  // owns it — we detect that by the session having a crossfitWorkoutId).
  if (day.workoutSessionId) {
    const [existing] = await tx
      .select({
        id: workoutSessions.id,
        crossfitWorkoutId: workoutSessions.crossfitWorkoutId,
      })
      .from(workoutSessions)
      .where(eq(workoutSessions.id, day.workoutSessionId))
      .limit(1);
    if (!existing) {
      // Stale FK — fall through to the "no link" path below.
    } else if (existing.crossfitWorkoutId) {
      // Smart-builder owns this session; the free-text body is purely
      // supplementary on programming_track_days and not surfaced as its
      // own session.
      return existing.id;
    } else {
      // Free-text session: update body + scoring; remove it entirely if
      // the day's body has been cleared.
      if (!shouldExist) {
        await tx
          .delete(workoutSessions)
          .where(eq(workoutSessions.id, existing.id));
        await tx
          .update(programmingTrackDays)
          .set({ workoutSessionId: null })
          .where(eq(programmingTrackDays.id, day.id));
        return null;
      }
      await tx
        .update(workoutSessions)
        .set({
          body,
          title: track.name,
          isScored: day.isScored,
          scoreType: day.scoreType ?? null,
          published: true,
        })
        .where(eq(workoutSessions.id, existing.id));
      return existing.id;
    }
  }

  if (!shouldExist) return null;

  // No linked session yet — create one at the resolved position.
  const position = await resolveInlinePosition(tx, {
    communityId: track.communityId,
    workoutDate: day.date,
    inlinePosition: insertPosition,
  });

  const [row] = await tx
    .insert(workoutSessions)
    .values({
      communityId: track.communityId,
      workoutDate: day.date,
      kind: sectionKind,
      position,
      title: track.name,
      body,
      isScored: day.isScored,
      scoreType: day.scoreType ?? null,
      sourceTrackId: track.id,
      source: "programming",
      published: true,
    })
    .returning({ id: workoutSessions.id });

  await tx
    .update(programmingTrackDays)
    .set({ workoutSessionId: row.id })
    .where(eq(programmingTrackDays.id, day.id));

  return row.id;
}

/**
 * Sync every free-text day on the track. Used when the track status
 * flips draft → active so any free-text days authored earlier surface
 * for members without waiting for a release publish.
 */
export async function syncAllFreeTextDaysForTrack(
  tx: Tx,
  track: ProgrammingTrack
): Promise<{ synced: number }> {
  const days = await tx
    .select({
      id: programmingTrackDays.id,
      date: programmingTrackDays.date,
      body: programmingTrackDays.body,
      workoutSessionId: programmingTrackDays.workoutSessionId,
      isScored: programmingTrackDays.isScored,
      scoreType: programmingTrackDays.scoreType,
    })
    .from(programmingTrackDays)
    .where(eq(programmingTrackDays.trackId, track.id));

  let synced = 0;
  for (const day of days) {
    const result = await syncFreeTextTrackDaySession(tx, { track, day });
    if (result) synced += 1;
  }
  return { synced };
}
