import { useQuery } from "@tanstack/react-query";

export interface HyroxStationBenchmark {
  id: string;
  userId: string;
  station: string;
  timeSeconds: number;
  loggedAt: string;
  source: string | null;
  notes: string | null;
  sourceRaceId: string | null;
}

export function useHyroxStationBenchmarks() {
  return useQuery({
    queryKey: ["hyrox-station-benchmarks"],
    queryFn: async (): Promise<HyroxStationBenchmark[]> => {
      const response = await fetch("/api/hyrox/benchmarks");
      if (!response.ok) throw new Error("Failed to fetch station benchmarks");
      return response.json();
    },
  });
}
