"use client";

import { useQuery } from "@tanstack/react-query";
import type { SegmentAggregate } from "@/lib/insights/queries";

import type { DivisionKey } from "@/lib/hyrox-data";

const STALE_TIME = 60 * 60 * 1000; // 1 hour

export function useInsightsAverages(division: DivisionKey, eventId?: string) {
  return useQuery<SegmentAggregate[]>({
    queryKey: ["insights-averages", division, eventId],
    queryFn: async () => {
      const params = new URLSearchParams({ division });
      if (eventId) params.set("eventId", eventId);
      const res = await fetch(`/api/public/insights/averages?${params}`);
      if (!res.ok) throw new Error("Failed to fetch averages");
      return res.json();
    },
    staleTime: STALE_TIME,
  });
}

export function useInsightsDistributions(
  division: DivisionKey,
  segmentType: "run" | "station" | "roxzone",
  eventId?: string,
) {
  return useQuery<SegmentAggregate[]>({
    queryKey: ["insights-distributions", division, segmentType, eventId],
    queryFn: async () => {
      const params = new URLSearchParams({ division, segmentType });
      if (eventId) params.set("eventId", eventId);
      const res = await fetch(`/api/public/insights/distributions?${params}`);
      if (!res.ok) throw new Error("Failed to fetch distributions");
      return res.json();
    },
    staleTime: STALE_TIME,
  });
}

export function useInsightsComparisons(division: DivisionKey, eventId?: string) {
  return useQuery({
    queryKey: ["insights-comparisons", division, eventId],
    queryFn: async () => {
      const params = new URLSearchParams({ division });
      if (eventId) params.set("eventId", eventId);
      const res = await fetch(`/api/public/insights/comparisons?${params}`);
      if (!res.ok) throw new Error("Failed to fetch comparisons");
      return res.json();
    },
    enabled: !!eventId,
    staleTime: STALE_TIME,
  });
}

export function useInsightsFeatureImportance(division: DivisionKey) {
  return useQuery<{
    features: Array<{ feature: string; importance: number }>;
    trainingN: number;
    metrics: Record<string, number>;
  } | null>({
    queryKey: ["insights-feature-importance", division],
    queryFn: async () => {
      const res = await fetch(
        `/api/public/insights/feature-importance?division=${division}`,
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch feature importance");
      return res.json();
    },
    staleTime: STALE_TIME,
  });
}

export function useInsightsOverlay(division: DivisionKey, enabled: boolean) {
  return useQuery<Array<{ segmentLabel: string; timeSeconds: number }>>({
    queryKey: ["insights-overlay", division],
    queryFn: async () => {
      const res = await fetch(`/api/hyrox/insights/overlay?division=${division}`);
      if (!res.ok) throw new Error("Failed to fetch overlay");
      return res.json();
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 min — user data changes more often
  });
}

export function useInsightsEvents() {
  return useQuery<
    Array<{ id: string; name: string; city: string; country: string; eventDate: string }>
  >({
    queryKey: ["insights-events"],
    queryFn: async () => {
      const res = await fetch("/api/public/insights/events");
      if (!res.ok) throw new Error("Failed to fetch events");
      return res.json();
    },
    staleTime: STALE_TIME,
  });
}
