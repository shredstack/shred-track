import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  BenchmarkWorkout,
  BenchmarkCategory,
  BenchmarkCategoryName,
  BenchmarkHistoryResponse,
} from "@/types/crossfit";
import type { CreatePartInput } from "@/hooks/useWorkouts";

async function fetchBenchmarks(params?: {
  search?: string;
  category?: BenchmarkCategory;
  benchmarkCategory?: BenchmarkCategoryName;
  communityId?: string;
  includeStats?: boolean;
}): Promise<BenchmarkWorkout[]> {
  const searchParams = new URLSearchParams();
  if (params?.search) searchParams.set("search", params.search);
  if (params?.category) searchParams.set("category", params.category);
  if (params?.benchmarkCategory)
    searchParams.set("benchmarkCategory", params.benchmarkCategory);
  if (params?.communityId) searchParams.set("communityId", params.communityId);
  if (params?.includeStats) searchParams.set("includeStats", "true");

  const url = `/api/benchmarks${searchParams.toString() ? `?${searchParams}` : ""}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("Failed to fetch benchmarks");
  return response.json();
}

export function useBenchmarks(params?: {
  search?: string;
  category?: BenchmarkCategory;
  benchmarkCategory?: BenchmarkCategoryName;
  communityId?: string;
  includeStats?: boolean;
}) {
  return useQuery({
    queryKey: ["benchmarks", params],
    queryFn: () => fetchBenchmarks(params),
  });
}

// Returns BenchmarkHistory for non-weightlifting benchmarks, and
// WeightliftingBenchmarkHistory for weightlifting ones (discriminated by
// presence of `repMaxHistory`).
export function useBenchmarkHistory(benchmarkId: string | null) {
  return useQuery({
    queryKey: ["benchmark-history", benchmarkId],
    queryFn: async (): Promise<BenchmarkHistoryResponse> => {
      const response = await fetch(`/api/benchmarks/${benchmarkId}/history`);
      if (!response.ok) throw new Error("Failed to fetch benchmark history");
      return response.json();
    },
    enabled: !!benchmarkId,
  });
}

export interface CreateBenchmarkInput {
  name: string;
  description?: string;
  category?: BenchmarkCategoryName | null;
  communityId?: string;
  isPartner?: boolean;
  partnerCount?: number;
  parts: CreatePartInput[];
}

export function useCreateBenchmark() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateBenchmarkInput) => {
      const response = await fetch("/api/benchmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to create benchmark");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["benchmarks"] });
    },
  });
}

export function useDeleteBenchmark() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/benchmarks/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to delete benchmark");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["benchmarks"] });
    },
  });
}

export function useCreateWorkoutFromBenchmark() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      benchmarkWorkoutId: string;
      workoutDate: string;
      communityId?: string;
      isPartner?: boolean;
      partnerCount?: number;
    }) => {
      const response = await fetch("/api/workouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to create workout");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workouts"] });
      queryClient.invalidateQueries({ queryKey: ["benchmarks"] });
    },
  });
}

// Build a single-movement for_load workout at the named rep target and
// let the server's auto-link inference tie it to the matching
// weightlifting benchmark. Used by the rep-max tabs' "Log a {N}RM" CTA.
export function useCreateRepMaxAttempt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      movementId: string;
      movementName: string;
      repTarget: 1 | 2 | 3 | 5;
      workoutDate: string;
    }) => {
      const body = {
        title: `${data.movementName} ${data.repTarget}RM`,
        workoutDate: data.workoutDate,
        parts: [
          {
            workoutType: "for_load",
            repScheme: String(data.repTarget),
            movements: [
              {
                movementId: data.movementId,
                prescribedReps: String(data.repTarget),
              },
            ],
          },
        ],
      };
      const response = await fetch("/api/workouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to create workout");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workouts"] });
      queryClient.invalidateQueries({ queryKey: ["benchmarks"] });
      queryClient.invalidateQueries({ queryKey: ["benchmark-history"] });
    },
  });
}
