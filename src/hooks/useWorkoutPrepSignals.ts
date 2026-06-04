"use client";

import { useQuery } from "@tanstack/react-query";
import type { WorkoutPrepSignals } from "@/lib/crossfit/insights/prep-signals";

const STALE_TIME = 5 * 60 * 1000; // 5 minutes — signals refresh nightly

// Fetches the workout-detail prep-card payload (stretch goals +
// movement-attributed complaint banners). Pass `enabled: false` to skip
// the fetch entirely for logged workouts where the card hides itself
// anyway — saves a round trip on the common path.
export function useWorkoutPrepSignals(
  workoutId: string | null | undefined,
  opts?: { enabled?: boolean }
) {
  return useQuery<WorkoutPrepSignals>({
    queryKey: ["workout-prep-signals", workoutId ?? null],
    queryFn: async () => {
      const res = await fetch(
        `/api/crossfit/workouts/${workoutId}/prep-signals`
      );
      if (!res.ok) throw new Error("Failed to fetch prep signals");
      return res.json();
    },
    enabled: !!workoutId && (opts?.enabled ?? true),
    staleTime: STALE_TIME,
  });
}
