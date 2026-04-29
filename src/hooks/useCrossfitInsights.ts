"use client";

import { useQuery } from "@tanstack/react-query";
import type { Predicted1RMResult } from "@/lib/crossfit/insights/predicted-1rm";
import type { RxGapResult } from "@/lib/crossfit/insights/rx-gap";

const STALE_TIME = 5 * 60 * 1000; // 5 minutes — these don't change rapidly

export function useOneRmPredictions() {
  return useQuery<Predicted1RMResult>({
    queryKey: ["crossfit-insights", "1rm-predictions"],
    queryFn: async () => {
      const res = await fetch("/api/crossfit/insights/1rm-predictions");
      if (!res.ok) throw new Error("Failed to fetch 1RM predictions");
      return res.json();
    },
    staleTime: STALE_TIME,
  });
}

export function useRxGap(windowDays?: number) {
  return useQuery<RxGapResult>({
    queryKey: ["crossfit-insights", "rx-gap", windowDays ?? 180],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (windowDays) params.set("windowDays", String(windowDays));
      const url = `/api/crossfit/insights/rx-gap${params.toString() ? `?${params}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch RX gap");
      return res.json();
    },
    staleTime: STALE_TIME,
  });
}
