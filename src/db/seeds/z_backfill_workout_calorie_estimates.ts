// ---------------------------------------------------------------------------
// Backfill template-level calorie estimates on crossfit_workouts.
// ---------------------------------------------------------------------------
//
// Existing rows were computed under older estimator logic and won't pick up
// changes (e.g. the template-level confidence fix that stopped demoting for
// "no user pace observed" — which can never be true at template level) until
// the workout is edited and the Inngest `workouts/calories.compute` event
// re-runs. This seed forces the recompute so the UI reflects the new logic
// immediately on deploy.
//
// Idempotency strategy: gated by `estimatedKcalComputedAt < SENTINEL`. After
// the first deploy every touched row's `computedAt` is post-sentinel, so
// subsequent deploys find zero candidates and no-op. Bump SENTINEL whenever
// the calorie estimator math changes in a way that should reflow stored
// template estimates.
//
// Must run AFTER `movements-met-values.ts` so MET values are current before
// recompute. The `z_` filename prefix puts this seed last in alphabetical
// order, which is how `run-all.ts` sequences seeds.
// ---------------------------------------------------------------------------

import { config } from "dotenv";
config({ path: ".env.local" });

import { isNull, lt, or } from "drizzle-orm";
import { fileURLToPath } from "url";

import { db } from "..";
import { crossfitWorkouts } from "../schema";
import { computeAndStoreWorkoutEstimate } from "@/lib/calories/orchestrator";

// Bump when the estimator logic changes and stored rows need to reflow.
const SENTINEL = new Date("2026-05-29T16:00:00Z");

export async function run() {
  // Include NULL computedAt: SQL `NULL < x` is NULL (falsy), so a bare `<`
  // would silently skip rows that have a stored low/high but no timestamp —
  // exactly the legacy migrated rows we want to refresh.
  const candidates = await db
    .select({ id: crossfitWorkouts.id })
    .from(crossfitWorkouts)
    .where(
      or(
        isNull(crossfitWorkouts.estimatedKcalComputedAt),
        lt(crossfitWorkouts.estimatedKcalComputedAt, SENTINEL)
      )
    );

  if (candidates.length === 0) {
    console.log(
      "z_backfill_workout_calorie_estimates — no rows older than sentinel; skipping."
    );
    return;
  }

  console.log(
    `z_backfill_workout_calorie_estimates — recomputing ${candidates.length} workout(s)...`
  );

  let recomputed = 0;
  let noParts = 0;
  let failed = 0;
  for (const { id } of candidates) {
    try {
      const result = await computeAndStoreWorkoutEstimate(id);
      if (result === null) noParts++;
      else recomputed++;
    } catch (err) {
      failed++;
      console.error(`  recompute failed for ${id}:`, err);
    }
  }

  console.log(
    `z_backfill_workout_calorie_estimates — done. recomputed: ${recomputed}, no-parts: ${noParts}, failed: ${failed}`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
