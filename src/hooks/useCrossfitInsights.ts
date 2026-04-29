"use client";

import { useQuery } from "@tanstack/react-query";
import type { Predicted1RMResult } from "@/lib/crossfit/insights/predicted-1rm";
import type { RxGapResult } from "@/lib/crossfit/insights/rx-gap";
import type { DomainProfile } from "@/lib/crossfit/insights/domain-profile";
import type { TrendsResult } from "@/lib/crossfit/insights/trends";
import type { NotesInsights } from "@/lib/crossfit/insights/notes-extraction";

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

export function useDomainProfile() {
  return useQuery<DomainProfile>({
    queryKey: ["crossfit-insights", "domain-profile"],
    queryFn: async () => {
      const res = await fetch("/api/crossfit/insights/domain-profile");
      if (!res.ok) throw new Error("Failed to fetch domain profile");
      return res.json();
    },
    staleTime: STALE_TIME,
  });
}

export function useTrends(volumeWeeks?: number) {
  return useQuery<TrendsResult>({
    queryKey: ["crossfit-insights", "trends", volumeWeeks ?? 12],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (volumeWeeks) params.set("weeks", String(volumeWeeks));
      const url = `/api/crossfit/insights/trends${params.toString() ? `?${params}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch trends");
      return res.json();
    },
    staleTime: STALE_TIME,
  });
}

// VIP-gated. Pass `enabled: false` for non-VIPs so we don't burn a 403.
export function useNotesInsights(opts?: { enabled?: boolean }) {
  return useQuery<NotesInsights>({
    queryKey: ["crossfit-insights", "notes"],
    queryFn: async () => {
      const res = await fetch("/api/crossfit/insights/notes");
      if (!res.ok) throw new Error("Failed to fetch notes insights");
      return res.json();
    },
    enabled: opts?.enabled ?? true,
    staleTime: STALE_TIME,
  });
}
