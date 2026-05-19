// Injects inline programming-track sections into a release's daily
// workouts. Called from the publish endpoint after the release is
// flipped to 'published'.

import { and, asc, eq, gte, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  programmingTrackDays,
  programmingTracks,
  workoutSections,
  workouts,
} from "@/db/schema";
import { sql } from "drizzle-orm";

/**
 * For each active inline (or inline_and_standalone) track that overlaps the
 * release week, inject a workout_section per day where the track has a
 * prescription. Idempotent: skips days that already have a section with
 * sourceTrackId set for the track.
 */
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

  // Build a map from (trackId, date) → trackDay.
  const dayByKey = new Map<string, typeof days[number]>();
  for (const d of days) {
    dayByKey.set(`${d.trackId}|${d.date}`, d);
  }

  // Load the gym's workouts for the week.
  const weekWorkouts = await db
    .select({
      id: workouts.id,
      workoutDate: workouts.workoutDate,
    })
    .from(workouts)
    .where(
      and(
        eq(workouts.communityId, opts.communityId),
        gte(workouts.workoutDate, opts.weekStart),
        lte(workouts.workoutDate, weekEnd)
      )
    );
  if (!weekWorkouts.length) return { inserted: 0 };

  let inserted = 0;
  for (const track of tracks) {
    const sectionKind =
      track.kind === "monthly_challenge" ? "monthly_challenge" : "custom";
    const insertPosition = track.inlinePosition ?? "end_of_day";

    for (const w of weekWorkouts) {
      const td = dayByKey.get(`${track.id}|${w.workoutDate}`);
      if (!td) continue;

      // Idempotency: skip if a section already exists for this workout +
      // sourceTrack.
      const existing = await db
        .select({ id: workoutSections.id })
        .from(workoutSections)
        .where(
          and(
            eq(workoutSections.workoutId, w.id),
            eq(workoutSections.sourceTrackId, track.id)
          )
        )
        .limit(1);
      if (existing.length) continue;

      // Pick position based on inlinePosition.
      let position: number;
      if (insertPosition === "top") {
        position = -1;
        // Shift existing sections down so the inline lands at 0.
        await db.execute(
          sql`update workout_sections set position = position + 1 where workout_id = ${w.id}`
        );
        position = 0;
      } else if (insertPosition === "after_wod") {
        const wod = await db
          .select({ position: workoutSections.position })
          .from(workoutSections)
          .where(
            and(
              eq(workoutSections.workoutId, w.id),
              eq(workoutSections.kind, "wod")
            )
          )
          .orderBy(asc(workoutSections.position))
          .limit(1);
        position = (wod[0]?.position ?? 0) + 1;
        await db.execute(
          sql`update workout_sections set position = position + 1 where workout_id = ${w.id} and position >= ${position}`
        );
      } else {
        // end_of_day
        const [maxRow] = await db
          .select({
            max: sql<number>`coalesce(max(${workoutSections.position}), -1)::int`,
          })
          .from(workoutSections)
          .where(eq(workoutSections.workoutId, w.id));
        position = (maxRow?.max ?? -1) + 1;
      }

      await db.insert(workoutSections).values({
        workoutId: w.id,
        kind: sectionKind,
        position,
        title: track.name,
        isScored: td.isScored,
        scoreType: td.scoreType ?? null,
        sourceTrackId: track.id,
      });
      // Also point the track day at the workout for cross-linking.
      await db
        .update(programmingTrackDays)
        .set({ workoutId: w.id })
        .where(eq(programmingTrackDays.id, td.id));
      inserted++;
    }
  }
  return { inserted };
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
