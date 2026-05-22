"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCoachMode, type CoachMode } from "@/hooks/useCoachMode";
import { useActiveMembership } from "@/hooks/useGymContext";
import { cn } from "@/lib/utils";

// Route prefixes that only appear in one mode's bottom/side nav. Toggling
// away from a section that won't survive the switch redirects to the target
// mode's landing page; shared pages (Home, Profile) are left untouched.
const COACH_ONLY_PREFIXES = ["/gym", "/admin"];
const MEMBER_ONLY_PREFIXES = ["/crossfit", "/hyrox", "/recovery", "/classes"];

// Prefix match on path segments so "/recovery" matches "/recovery/movements"
// but not an unrelated "/recovery-foo".
function isUnder(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`));
}

// Two-segment pill. Visually persistent (not a hamburger) so coaches can
// see what mode they're in at a glance. Spec §1.4 / brainstorm D4.
export function CoachModePill() {
  const membership = useActiveMembership();
  const { mode, setMode, hydrated } = useCoachMode();
  const router = useRouter();
  const pathname = usePathname();

  // Only render when the active gym has coach/admin role. Sarah-on-personal
  // never sees this.
  if (!membership || (!membership.isCoach && !membership.isAdmin)) {
    return null;
  }

  // Pre-hydration render — match SSR fallback (always 'member' before
  // localStorage is read) to avoid hydration mismatch.
  const effectiveMode = hydrated ? mode : "member";

  // Flip the mode, then redirect only when the current page has no nav tab
  // in the target mode. Coach-only pages drop to /home on the way to member
  // mode; member-only pages drop to /gym on the way to coach mode.
  const switchTo = (next: CoachMode) => {
    if (next === effectiveMode) return;
    setMode(next);
    if (next === "member" && isUnder(pathname, COACH_ONLY_PREFIXES)) {
      router.push("/home");
    } else if (next === "coach" && isUnder(pathname, MEMBER_ONLY_PREFIXES)) {
      router.push("/gym");
    }
  };

  return (
    <div
      role="group"
      aria-label="View mode"
      className="inline-flex items-center rounded-full border border-white/[0.06] bg-white/[0.04] p-0.5 text-[11px] font-semibold uppercase tracking-wide"
    >
      <button
        type="button"
        onClick={() => switchTo("member")}
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
        onClick={() => switchTo("coach")}
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
