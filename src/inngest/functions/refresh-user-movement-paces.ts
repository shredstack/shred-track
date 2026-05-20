// ============================================================
// Inngest cron: refresh user_movement_paces from logged scores.
// ============================================================
//
// For each (user, movement) pair with ≥3 logged scores carrying derivable
// rep-time, compute median seconds-per-rep and upsert. The next score the
// athlete logs will pick up their personal cadence automatically — no
// recompute of historical estimates.
//
// Derivation: per-set entries (for_load) and per-round rep counts paired
// with a duration field (durationSeconds or timeSeconds) give us a per-rep
// pace. For metcons we use score.durationSeconds / sum-of-prescribed-reps.

import { sql } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "@/db";
import { userMovementPaces } from "@/db/schema";

const MIN_SAMPLES = 3;
const MIN_PACE = 0.3; // sec/rep — anything faster is implausible
const MAX_PACE = 30;  // sec/rep — anything slower means we miscounted

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export const refreshUserMovementPaces = inngest.createFunction(
  {
    id: "refresh-user-movement-paces",
    name: "Refresh user movement paces",
    concurrency: { limit: 1 },
    triggers: [{ cron: "0 7 * * *" }], // 07:00 UTC daily
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ step }: { step: any }) => {
    return step.run("aggregate", async () => {
      // Pull (user, movement, rep-seconds-sample) triples in one query.
      // The CTE filters to durations we can trust (>30s metcon or for_load
      // with a per-set count). The aggregator is in TS so the median is
      // deterministic across DBs.
      const rows = await db.execute<{
        user_id: string;
        movement_id: string;
        sample: number;
      }>(sql`
        with movement_reps as (
          select
            s.user_id,
            wm.movement_id,
            coalesce(s.duration_seconds, s.time_seconds) as duration,
            -- naive reps fallback: total_reps from the score (works for
            -- amrap / for_calories), else prescribed_reps as int (works for
            -- fixed-rep for_time pieces). NULL → row filtered out.
            coalesce(
              s.total_reps::numeric,
              nullif(regexp_replace(wm.prescribed_reps, '[^0-9]', '', 'g'), '')::numeric
            ) as reps
          from scores s
          join workout_movements wm on wm.workout_part_id = s.workout_part_id
          join movements m on m.id = wm.movement_id
          where coalesce(s.duration_seconds, s.time_seconds) is not null
            and coalesce(s.duration_seconds, s.time_seconds) > 30
            and wm.is_side_cadence = false
            and m.is_paced_run = false
            and m.is_paced_erg is null
        )
        select
          user_id,
          movement_id,
          (duration / reps)::float as sample
        from movement_reps
        where reps is not null and reps > 0
          and (duration / reps) >= ${MIN_PACE}
          and (duration / reps) <= ${MAX_PACE}
      `);

      const samplesByKey = new Map<string, number[]>();
      for (const r of rows as unknown as Array<{
        user_id: string;
        movement_id: string;
        sample: number;
      }>) {
        const key = `${r.user_id}|${r.movement_id}`;
        const arr = samplesByKey.get(key) ?? [];
        arr.push(Number(r.sample));
        samplesByKey.set(key, arr);
      }

      let upserted = 0;
      for (const [key, samples] of samplesByKey) {
        if (samples.length < MIN_SAMPLES) continue;
        const [userId, movementId] = key.split("|");
        const observed = median(samples);
        await db
          .insert(userMovementPaces)
          .values({
            userId,
            movementId,
            repSecondsObserved: observed.toFixed(2),
            sampleSize: samples.length,
            lastComputedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [userMovementPaces.userId, userMovementPaces.movementId],
            set: {
              repSecondsObserved: observed.toFixed(2),
              sampleSize: samples.length,
              lastComputedAt: new Date(),
            },
          });
        upserted++;
      }
      return { upserted, candidateKeys: samplesByKey.size };
    });
  }
);
