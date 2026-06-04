"use client";

import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";

export interface SuggestionDTO {
  method: string;
  confidence: "high" | "medium" | "low";
  lowLb: number;
  highLb: number;
  anchor1rmLb: number | null;
  anchorSource: string | null;
  stimulusClass: string | null;
}

interface SuggestedWeightsResponse {
  templateId: string;
  parts: {
    partId: string;
    suggestions: Record<string, SuggestionDTO>;
  }[];
}

/**
 * Fetch the per-(part, movement) suggestion map for a template. The
 * workout card calls this once at the top and drills suggestions into
 * each `MovementRow`.
 */
export function useSuggestedWeights(crossfitWorkoutId: string | null) {
  return useQuery<SuggestedWeightsResponse>({
    queryKey: ["suggested-weights", crossfitWorkoutId],
    enabled: !!crossfitWorkoutId,
    // Suggestions change rarely between renders; 5 min is fine.
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await fetch(
        `/api/crossfit/templates/${crossfitWorkoutId}/suggested-weights`
      );
      if (!res.ok) throw new Error("Failed to load suggested weights");
      return res.json();
    },
  });
}

// Lightweight Context so each MovementRow doesn't have to be threaded a
// suggestion prop through every wrapper.
export const SuggestionContext = createContext<Map<
  string,
  SuggestionDTO
> | null>(null);

export function useSuggestionForMovement(
  crossfitWorkoutMovementId: string
): SuggestionDTO | null {
  const map = useContext(SuggestionContext);
  if (!map) return null;
  return map.get(crossfitWorkoutMovementId) ?? null;
}
