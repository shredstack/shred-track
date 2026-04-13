import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { BenchmarkWorkout, BenchmarkCategory } from "@/types/crossfit";

async function fetchBenchmarks(params?: {
  search?: string;
  category?: BenchmarkCategory;
  communityId?: string;
}): Promise<BenchmarkWorkout[]> {
  const searchParams = new URLSearchParams();
  if (params?.search) searchParams.set("search", params.search);
  if (params?.category) searchParams.set("category", params.category);
  if (params?.communityId) searchParams.set("communityId", params.communityId);

  const url = `/api/benchmarks${searchParams.toString() ? `?${searchParams}` : ""}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("Failed to fetch benchmarks");
  return response.json();
}

export function useBenchmarks(params?: {
  search?: string;
  category?: BenchmarkCategory;
  communityId?: string;
}) {
  return useQuery({
    queryKey: ["benchmarks", params],
    queryFn: () => fetchBenchmarks(params),
  });
}

export function useCreateBenchmark() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      name: string;
      description?: string;
      workoutType: string;
      timeCapSeconds?: number;
      amrapDurationSeconds?: number;
      repScheme?: string;
      communityId?: string;
      movements: {
        movementId: string;
        orderIndex: number;
        prescribedReps?: string;
        prescribedWeightMale?: number;
        prescribedWeightFemale?: number;
        rxStandard?: string;
      }[];
    }) => {
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
    },
  });
}
