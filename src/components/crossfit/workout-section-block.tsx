"use client";

import { ReactNode } from "react";
import type {
  WorkoutSectionDisplay,
  WorkoutSectionKindDisplay,
} from "@/types/crossfit";

const LABELS: Record<WorkoutSectionKindDisplay, string> = {
  warm_up: "Warm-up",
  pre_skill: "Pre-skill",
  wod: "WOD",
  post_skill: "Post-skill",
  stretching: "Stretching",
  at_home: "At-home",
  monthly_challenge: "Monthly challenge",
  custom: "Custom",
};

function scoreBadgeText(section: WorkoutSectionDisplay): string {
  if (!section.isScored) return "NO SCORE";
  return (section.scoreType ?? "scored").toUpperCase();
}

function scoreBadgeClass(section: WorkoutSectionDisplay): string {
  if (!section.isScored) {
    return "bg-muted/30 text-muted-foreground";
  }
  return "bg-amber-500/15 text-amber-400";
}

/**
 * Renders a single section heading + scoring badge, with the children
 * (parts) tucked below. The CrossFit tab uses this to break a multi-section
 * workout into visually distinct cards instead of one flat list.
 */
export function WorkoutSectionBlock({
  section,
  children,
}: {
  section: WorkoutSectionDisplay;
  children: ReactNode;
}) {
  const label = section.title?.trim() || LABELS[section.kind];
  return (
    <section className="space-y-3 rounded-lg border border-white/[0.05] bg-white/[0.02] p-3">
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-primary">
          {label}
        </h3>
        <span
          className={
            "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase " +
            scoreBadgeClass(section)
          }
        >
          {scoreBadgeText(section)}
        </span>
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
