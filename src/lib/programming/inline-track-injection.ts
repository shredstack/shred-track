// Injects inline programming-track sessions into a release week. Called
// from the publish endpoint after the release flips to 'published'.
//
// Unified-schema: a "section" IS a workout_sessions row. The injector
// creates one custom-kind session per (day with a track prescription),
// linked to its sourceTrackId and positioned according to the track's
// inlinePosition rule.

import { and, eq, gte, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  programmingTrackDays,
  programmingTracks,
  workoutSessions,
} from "@/db/schema";
import {
  resolveInlinePosition,
  type InlinePosition,
} from "@/lib/programming/track-position";

export async function injectInlineTrackSections(opts: {
  communityId: string;
  weekStart: string; // ISO date Monday
}): Promise<{ inserted: number }> {
  const weekEnd = addDays(opts.weekStart, 6);

  const tracks = await db
    .select()
    .from(programmingTracks)
    .where(
      and(
        eq(programmingTracks.communityId, opts.communityId),
        eq(programmingTracks.status, "active"),
        or(
          eq(programmingTracks.displayMode, "inline"),
          eq(programmingTracks.displayMode, "inline_and_standalone")
        ),
        lte(programmingTracks.startsOn, weekEnd),
        gte(programmingTracks.endsOn, opts.weekStart)
      )
    );
  if (!tracks.length) return { inserted: 0 };

  const days = await db
    .select()
    .from(programmingTrackDays)
    .where(
      and(
        gte(programmingTrackDays.date, opts.weekStart),
        lte(programmingTrackDays.date, weekEnd)
      )
    );
  if (!days.length) return { inserted: 0 };

  // (trackId, date) → trackDay.
  const dayByKey = new Map<string, (typeof days)[number]>();
  for (const d of days) {
    dayByKey.set(`${d.trackId}|${d.date}`, d);
  }

  // Distinct dates the gym has at least one session for in this week.
  const datesWithSessionsRows = await db
    .selectDistinct({ workoutDate: workoutSessions.workoutDate })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.communityId, opts.communityId),
        gte(workoutSessions.workoutDate, opts.weekStart),
        lte(workoutSessions.workoutDate, weekEnd)
      )
    );
  const weekDates = datesWithSessionsRows.map((r) => r.workoutDate);
  if (!weekDates.length) return { inserted: 0 };

  let inserted = 0;
  for (const track of tracks) {
    const sectionKind: "monthly_challenge" | "custom" =
      track.kind === "monthly_challenge" ? "monthly_challenge" : "custom";
    const insertPosition = (track.inlinePosition ??
      "end_of_day") as InlinePosition;

    for (const workoutDate of weekDates) {
      const td = dayByKey.get(`${track.id}|${workoutDate}`);
      if (!td) continue;

      // Idempotency: skip if a session already exists for this gym + date
      // sourced from the track. (The smart-builder and free-text write
      // paths now create sessions eagerly when the track is active, so
      // most inserts here are no-ops post-cutover.)
      const existing = await db
        .select({ id: workoutSessions.id })
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.communityId, opts.communityId),
            eq(workoutSessions.workoutDate, workoutDate),
            eq(workoutSessions.sourceTrackId, track.id)
          )
        )
        .limit(1);
      if (existing.length) continue;

      // Insert in a transaction so the position resolver's shift step
      // can't race a concurrent inject for the same day.
      const newSessionId = await db.transaction(async (tx) => {
        const position = await resolveInlinePosition(tx, {
          communityId: opts.communityId,
          workoutDate,
          inlinePosition: insertPosition,
        });

        const trackBody = (td.body ?? "").trim();
        const [row] = await tx
          .insert(workoutSessions)
          .values({
            communityId: opts.communityId,
            workoutDate,
            kind: sectionKind,
            position,
            title: track.name,
            body: trackBody.length > 0 ? td.body : "(track)",
            isScored: td.isScored,
            scoreType: td.scoreType ?? null,
            sourceTrackId: track.id,
            source: "programming",
            published: true,
          })
          .returning({ id: workoutSessions.id });

        await tx
          .update(programmingTrackDays)
          .set({ workoutSessionId: row.id })
          .where(eq(programmingTrackDays.id, td.id));
        return row.id;
      });
      if (newSessionId) inserted++;
    }
  }
  return { inserted };
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

