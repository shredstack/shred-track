"use client";

import { useCoachMode } from "@/hooks/useCoachMode";
import { useActiveMembership } from "@/hooks/useGymContext";
import { cn } from "@/lib/utils";

// Two-segment pill. Visually persistent (not a hamburger) so coaches can
// see what mode they're in at a glance. Spec §1.4 / brainstorm D4.
export function CoachModePill() {
  const membership = useActiveMembership();
  const { mode, setMode, hydrated } = useCoachMode();

  // Only render when the active gym has coach/admin role. Sarah-on-personal
  // never sees this.
  if (!membership || (!membership.isCoach && !membership.isAdmin)) {
    return null;
  }

  // Pre-hydration render — match SSR fallback (always 'member' before
  // localStorage is read) to avoid hydration mismatch.
  const effectiveMode = hydrated ? mode : "member";

  return (
    <div
      role="group"
      aria-label="View mode"
      className="inline-flex items-center rounded-full border border-white/[0.06] bg-white/[0.04] p-0.5 text-[11px] font-semibold uppercase tracking-wide"
    >
      <button
        type="button"
        onClick={() => setMode("member")}
        aria-pressed={effectiveMode === "member"}
        className={cn(
          "rounded-full px-2.5 py-0.5 transition-colors",
          effectiveMode === "member"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        Member
      </button>
      <button
        type="button"
        onClick={() => setMode("coach")}
        aria-pressed={effectiveMode === "coach"}
        className={cn(
          "rounded-full px-2.5 py-0.5 transition-colors",
          effectiveMode === "coach"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        Coach
      </button>
    </div>
  );
}
