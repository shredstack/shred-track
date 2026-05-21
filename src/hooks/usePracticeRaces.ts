import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api-fetch";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PracticeRace {
  id: string;
  userId: string;
  title: string | null;
  divisionKey: string | null;
  template: string;
  totalTimeSeconds: string; // numeric serializes as string
  startedAt: string;
  completedAt: string;
  notes: string | null;
  raceType: "practice" | "actual";
  createdAt: string;
}

export interface PracticeRaceSplit {
  id: string;
  raceId: string;
  segmentOrder: number;
  segmentType: "run" | "station";
  /** "roxzone" for transition-simulation runs, "prescribed_run" for 1km runs,
   *  null on legacy rows and on stations. */
  segmentSubtype: "prescribed_run" | "roxzone" | null;
  segmentLabel: string;
  distanceMeters: number | null;
  reps: number | null;
  /** Numeric (numeric column serializes as string from postgres). */
  weightKg: string | null;
  weightLabel: string | null;
  timeSeconds: string;
}

export interface PracticeRaceWithSplits extends PracticeRace {
  splits: PracticeRaceSplit[];
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const practiceRaceKeys = {
  all: ["practice-races"] as const,
  lists: () => [...practiceRaceKeys.all, "list"] as const,
  detail: (id: string) => [...practiceRaceKeys.all, "detail", id] as const,
  report: (id: string) => [...practiceRaceKeys.all, "report", id] as const,
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function usePracticeRaces() {
  return useQuery({
    queryKey: practiceRaceKeys.lists(),
    queryFn: (): Promise<PracticeRace[]> =>
      fetchJson<PracticeRace[]>("/api/hyrox/practice-races"),
  });
}

export function usePracticeRace(id: string | null) {
  return useQuery({
    queryKey: id ? practiceRaceKeys.detail(id) : ["practice-races", "detail", "none"],
    queryFn: (): Promise<PracticeRaceWithSplits> =>
      fetchJson<PracticeRaceWithSplits>(`/api/hyrox/practice-races/${id}`),
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface UpdatePracticeRaceInput {
  id: string;
  title?: string;
  notes?: string | null;
  raceType?: "practice" | "actual";
}

export function useUpdatePracticeRace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...patch }: UpdatePracticeRaceInput) => {
      const response = await fetch(`/api/hyrox/practice-races/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update race");
      }
      return response.json() as Promise<PracticeRace>;
    },
    onSuccess: (race) => {
      queryClient.invalidateQueries({ queryKey: practiceRaceKeys.lists() });
      queryClient.invalidateQueries({ queryKey: practiceRaceKeys.detail(race.id) });
    },
  });
}

export function useDeletePracticeRace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/hyrox/practice-races/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Failed to delete race");
      }
      return { id };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: practiceRaceKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ["benchmarks"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sort by completedAt desc (newest first). */
export function sortRacesNewestFirst(races: PracticeRace[]): PracticeRace[] {
  return [...races].sort(
    (a, b) =>
      new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
  );
}

/** Find the previous race of the same template (immediately older by completedAt). */
export function findPreviousSameTemplate(
  current: PracticeRace,
  all: PracticeRace[],
): PracticeRace | null {
  const sorted = sortRacesNewestFirst(all);
  const idx = sorted.findIndex((r) => r.id === current.id);
  if (idx === -1) return null;
  for (let i = idx + 1; i < sorted.length; i++) {
    if (sorted[i].template === current.template) return sorted[i];
  }
  return null;
}
