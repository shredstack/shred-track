// ---------------------------------------------------------------------------
// useFeatureFlag — client-side flag reader.
//
// Wraps GET /api/me/feature-flags. Refetched when the active gym changes
// (via useGymContext) so a gym switch picks up that gym's overrides without
// a page reload.
//
// Server components should call getAllFlags() / getFlag() from
// src/lib/feature-flags.ts directly — they bypass the network hop.
// ---------------------------------------------------------------------------

"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { useGymContext } from "@/hooks/useGymContext";

export type FlagValue = unknown;
export type FlagMap = Record<string, FlagValue>;

const FEATURE_FLAGS_KEY = ["feature-flags"] as const;

function useFlagMap() {
  const { data: gymContext } = useGymContext();
  const qc = useQueryClient();

  // When the active gym changes, the resolved overrides change. Invalidate
  // so the next render refetches.
  useEffect(() => {
    qc.invalidateQueries({ queryKey: FEATURE_FLAGS_KEY });
  }, [gymContext?.activeCommunityId, qc]);

  return useQuery<FlagMap>({
    queryKey: FEATURE_FLAGS_KEY,
    queryFn: async () => {
      const res = await fetch("/api/me/feature-flags");
      if (!res.ok) return {};
      return (await res.json()) as FlagMap;
    },
    staleTime: 60_000,
  });
}

/**
 * Returns `(key, fallback?) => value`. Treats unresolved flags as `fallback`
 * (default `undefined`).
 *
 * Usage:
 *   const getFlag = useFeatureFlag();
 *   if (getFlag('gym_programming') === true) { ... }
 */
export function useFeatureFlag() {
  const { data } = useFlagMap();
  return useCallback(
    <T = FlagValue>(key: string, fallback?: T): T | undefined => {
      const v = data?.[key];
      if (v === undefined) return fallback;
      return v as T;
    },
    [data]
  );
}

/** Boolean convenience: returns true if the flag resolves to truthy. */
export function useIsFeatureOn(key: string): boolean {
  const getFlag = useFeatureFlag();
  const v = getFlag(key);
  return v === true || v === "true" || v === 1;
}
