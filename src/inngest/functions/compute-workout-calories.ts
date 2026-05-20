// ============================================================
// Inngest: compute the template-level calorie estimate for a workout.
// ============================================================
//
// Triggered when:
//   • a workout is created
//   • a workout is edited (parts/movements changed)
//   • an admin updates a movement's MET value (fan-out to affected workouts)
//
// Uses a 75 kg reference athlete — per-athlete numbers live on `scores` and
// are computed inline at score-save time.

import { inngest } from "../client";
import { computeAndStoreWorkoutEstimate } from "@/lib/calories/orchestrator";

export const computeWorkoutCalories = inngest.createFunction(
  {
    id: "compute-workout-calories",
    name: "Compute workout calorie estimate",
    // Idempotent — recomputes converge on the same numbers. Concurrency cap
    // keeps a movement-MET fan-out from saturating the worker pool.
    concurrency: { limit: 10 },
    triggers: [{ event: "workouts/calories.compute" }],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async ({ event, step }: { event: any; step: any }) => {
    const workoutId = event?.data?.workoutId as string | undefined;
    if (!workoutId) return { skipped: "no workoutId" };

    return step.run("compute-and-store", async () => {
      const result = await computeAndStoreWorkoutEstimate(workoutId);
      if (!result) return { workoutId, skipped: "no parts" };
      return {
        workoutId,
        low: result.low,
        high: result.high,
        active: result.active,
        confidence: result.confidence,
        partCount: result.parts.length,
      };
    });
  }
);
