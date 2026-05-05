// ---------------------------------------------------------------------------
// useGymContext — single source of truth for "who am I and what gym am I in?"
//
// Wraps GET /api/me/gym-context. The header dropdown, the /gym admin
// gating, and per-workout permission decisions all read from this hook so
// nothing has to fetch this twice. Switching gyms calls
// useSetActiveCommunity which mutates server state and invalidates the
// query.
// ---------------------------------------------------------------------------

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

export interface GymMembership {
  communityId: string;
  communityName: string;
  /** Admins (and super admins) see the join code; members see null. */
  joinCode: string | null;
  isAdmin: boolean;
  isCoach: boolean;
  isActive: boolean;
  joinedAt: string;
}

export interface GymContext {
  user: {
    id: string;
    email: string;
    name: string;
    isSuperAdmin: boolean;
  };
  activeCommunityId: string | null;
  memberships: GymMembership[];
}

export const ACTIVE_GYM_LS_KEY = "shredtrack:activeCommunityId";

export function useGymContext() {
  return useQuery<GymContext>({
    queryKey: ["gym-context"],
    queryFn: async () => {
      const res = await fetch("/api/me/gym-context");
      if (!res.ok) throw new Error("Failed to fetch gym context");
      const data = (await res.json()) as GymContext;
      // Mirror to localStorage so first paint of the header dropdown can
      // read synchronously without waiting on this query.
      try {
        if (data.activeCommunityId) {
          window.localStorage.setItem(ACTIVE_GYM_LS_KEY, data.activeCommunityId);
        } else {
          window.localStorage.removeItem(ACTIVE_GYM_LS_KEY);
        }
      } catch {
        // localStorage may throw in private mode; ignore.
      }
      return data;
    },
    staleTime: 30_000,
  });
}

export function useSetActiveCommunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (communityId: string | null) => {
      const res = await fetch("/api/me/active-community", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ communityId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to set active gym");
      }
      return communityId;
    },
    onSuccess: (communityId) => {
      try {
        if (communityId) {
          window.localStorage.setItem(ACTIVE_GYM_LS_KEY, communityId);
        } else {
          window.localStorage.removeItem(ACTIVE_GYM_LS_KEY);
        }
      } catch {
        // ignore
      }
      qc.invalidateQueries({ queryKey: ["gym-context"] });
      // Workout queries are keyed by activeCommunityId — refetch all of
      // them so the CrossFit page reflects the new gym immediately.
      qc.invalidateQueries({ queryKey: ["workouts"] });
    },
  });
}

/** Convenience: the active membership object (or null when in personal mode). */
export function useActiveMembership(): GymMembership | null {
  const { data } = useGymContext();
  return useMemo(() => {
    if (!data?.activeCommunityId) return null;
    return (
      data.memberships.find(
        (m) => m.communityId === data.activeCommunityId && m.isActive
      ) ?? null
    );
  }, [data]);
}

/** Reads localStorage on mount so the first frame of the dropdown can show
 *  the cached active gym. Only useful before useGymContext resolves. */
export function useCachedActiveCommunityId(): string | null {
  const memo = useMemo(() => {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(ACTIVE_GYM_LS_KEY);
    } catch {
      return null;
    }
  }, []);
  // Touch effect so the linter is happy if we add SSR-safe variants later.
  useEffect(() => {}, []);
  return memo;
}
