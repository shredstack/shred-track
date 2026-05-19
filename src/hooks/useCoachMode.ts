// ---------------------------------------------------------------------------
// useCoachMode — per-device preference for the coach/member view switch.
//
// Sarah-on-iPhone vs Sarah-on-iPad keeps their own preference. Stored in
// localStorage so it survives reloads but never syncs to the DB.
//
// Coach mode is a *view* preference — server-side authz still gates
// coach-only routes by role. Toggling never grants access; it just shows
// the coach-mode chrome (different bottom nav, different surfaces).
// ---------------------------------------------------------------------------

"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useActiveMembership } from "@/hooks/useGymContext";

export type CoachMode = "member" | "coach";

export const COACH_MODE_LS_KEY = "shredtrack:coachMode";

function readStored(): CoachMode {
  if (typeof window === "undefined") return "member";
  try {
    const v = window.localStorage.getItem(COACH_MODE_LS_KEY);
    return v === "coach" ? "coach" : "member";
  } catch {
    return "member";
  }
}

// In-process subscribers — same tab toggles fire these immediately;
// cross-tab updates come in via the storage event below.
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === COACH_MODE_LS_KEY) onChange();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(onChange);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

// Server snapshot — must be stable across renders to avoid hydration churn.
const SERVER_DEFAULT: CoachMode = "member";

export function useCoachMode() {
  const mode = useSyncExternalStore<CoachMode>(
    subscribe,
    readStored,
    () => SERVER_DEFAULT
  );

  const update = useCallback((next: CoachMode) => {
    try {
      window.localStorage.setItem(COACH_MODE_LS_KEY, next);
    } catch {
      // Private mode / quota; tolerated.
    }
    // Notify same-tab listeners immediately (storage event only fires
    // across tabs).
    for (const fn of listeners) fn();
  }, []);

  const toggle = useCallback(() => {
    update(mode === "coach" ? "member" : "coach");
  }, [mode, update]);

  // `hydrated` retained for callers that want to suppress flash on SSR.
  const hydrated = typeof window !== "undefined";

  return { mode, setMode: update, toggle, hydrated };
}

/**
 * True if the user has any coach/admin role on the active gym AND has
 * toggled into coach mode. Used by the bottom nav and other surfaces that
 * branch on view.
 */
export function useIsCoachMode(): boolean {
  const { mode } = useCoachMode();
  const membership = useActiveMembership();
  if (!membership) return false;
  if (!(membership.isCoach || membership.isAdmin)) return false;
  return mode === "coach";
}
