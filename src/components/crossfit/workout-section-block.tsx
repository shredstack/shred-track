"use client";

import { ReactNode } from "react";
import { Flame, Trophy } from "lucide-react";
import type {
  WorkoutSectionDisplay,
  WorkoutSectionKindDisplay,
} from "@/types/crossfit";
import { Button } from "@/components/ui/button";
import { TrackDayScoreInput } from "@/components/crossfit/track-day-score-input";
import type { TrackScoringConfig } from "@/types/programming-tracks";

/**
 * Visual variant for the section block.
 * - `embedded` (default): subtle border, fits inside an outer Card (legacy
 *   use inside WorkoutCard).
 * - `standalone`: larger spacing + Card-grade surface, used by
 *   ProgrammedWorkoutDay to render each section as its own top-level card.
 */
export type WorkoutSectionBlockVariant = "embedded" | "standalone";

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

/**
 * Renders a single section heading with the children (parts) tucked below.
 * The CrossFit tab uses this to break a multi-section workout into visually
 * distinct cards instead of one flat list. Per-part scoring (AMRAP, time,
 * weight) lives inside the part cards themselves.
 *
 * Track-injected sections (spec §3.5): when the section has a
 * `sourceTrackId` + `trackDayId` but no workoutPart children, render a
 * `TrackDayScoreInput` below the body. Rest days (`isScored=false`) skip
 * the input — body text only.
 */
export function WorkoutSectionBlock({
  section,
  children,
  variant = "embedded",
  onViewTrackDayLeaderboard,
  onLogScore,
  onViewLeaderboard,
  sectionHasScore,
  sectionIsMultiPart,
}: {
  section: WorkoutSectionDisplay;
  children: ReactNode;
  /** See `WorkoutSectionBlockVariant`. Defaults to `embedded` for
   *  backwards-compat with WorkoutCard. */
  variant?: WorkoutSectionBlockVariant;
  /** Optional handler for free-form track-day sections — opens a
   *  community leaderboard for that day's scores. Hidden in personal
   *  view (where the parent doesn't pass the handler). */
  onViewTrackDayLeaderboard?: (trackDayId: string, title: string) => void;
  /** Per-section Log Score CTA. Parent decides when to render it (only
   *  for scored sections with Smart-Builder parts); when omitted the
   *  section card has no scoring affordance. */
  onLogScore?: () => void;
  /** Per-section leaderboard CTA. Same gating logic as onLogScore — only
   *  rendered for scored sections with Smart-Builder parts. */
  onViewLeaderboard?: () => void;
  /** Drives Trophy (already scored) vs Flame (not yet) icon. */
  sectionHasScore?: boolean;
  /** Pluralizes "Log Score" → "Log Scores" when the section has more
   *  than one scoreable part. */
  sectionIsMultiPart?: boolean;
}) {
  const kindLabel = LABELS[section.kind];
  const customTitle = section.title?.trim();
  const body = section.body?.trim();
  const notes = section.notes?.trim();
  const hasParts = (section.partIds?.length ?? 0) > 0;
  const isFreeFormTrackDay =
    !!section.sourceTrackId && !!section.trackDayId && !hasParts;
  const isStandalone = variant === "standalone";
  // Standalone variant carries Card-grade surface (used as the top-level
  // unit on the CrossFit tab for programming-published workouts).
  // Embedded variant keeps the subtle inner border that fits inside an
  // outer Card wrapper.
  const containerClass = isStandalone
    ? "space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5 shadow-sm"
    : "space-y-3 rounded-lg border border-white/[0.05] bg-white/[0.02] p-3";
  const titleClass = isStandalone
    ? "text-lg font-semibold text-foreground"
    : "text-sm font-semibold text-foreground/90";
  const kindClass = isStandalone
    ? "text-xs font-bold uppercase tracking-wider text-primary"
    : "text-xs font-bold uppercase tracking-wider text-primary";
  // Sections with movement-level parts (Smart-Builder WODs / skill work)
  // get their prescription from the parts themselves — any freeform body
  // text on those sections is supplementary, so we push it (and notes) to
  // the bottom as "coach notes". Sections without parts (warm-up,
  // stretching) keep body at the top because that *is* the prescription.
  const showFreeformAtTop = !!body && !hasParts;
  const trailingBody = !!body && hasParts ? body : null;
  return (
    <section className={containerClass}>
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className={kindClass}>{kindLabel}</h3>
        {customTitle ? (
          <span className={titleClass}>{customTitle}</span>
        ) : null}
      </header>
      {showFreeformAtTop ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
          {body}
        </p>
      ) : null}
      <div className="space-y-3">{children}</div>
      {(trailingBody || notes) && (
        <div className="space-y-1.5 rounded-md border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-400/80">
            Coach notes
          </p>
          {trailingBody ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/85">
              {trailingBody}
            </p>
          ) : null}
          {notes ? (
            <p className="whitespace-pre-wrap text-sm italic leading-relaxed text-foreground/75">
              {notes}
            </p>
          ) : null}
        </div>
      )}
      {onLogScore || onViewLeaderboard ? (
        <div className="flex flex-wrap gap-2">
          {onLogScore ? (
            <Button
              size="sm"
              variant={sectionHasScore ? "outline" : "default"}
              className={
                sectionHasScore
                  ? "flex-1 border-white/[0.08]"
                  : "flex-1"
              }
              onClick={onLogScore}
            >
              {sectionHasScore ? (
                <Trophy className="size-3.5" />
              ) : (
                <Flame className="size-3.5" />
              )}
              {sectionHasScore
                ? sectionIsMultiPart
                  ? "Edit Scores"
                  : "Edit Score"
                : sectionIsMultiPart
                  ? "Log Scores"
                  : "Log Score"}
            </Button>
          ) : null}
          {onViewLeaderboard ? (
            <Button
              size="sm"
              variant="outline"
              className="border-white/[0.08]"
              onClick={onViewLeaderboard}
            >
              Leaderboard
            </Button>
          ) : null}
        </div>
      ) : null}
      {isFreeFormTrackDay && section.isScored && (
        <>
          <TrackDayScoreInput
            trackDayId={section.trackDayId!}
            scoringConfig={
              (section.trackScoringConfig as TrackScoringConfig | null) ?? null
            }
            prescribedValue={section.trackPrescribedValue ?? null}
          />
          {onViewTrackDayLeaderboard && (
            <div className="pt-0.5">
              <Button
                variant="outline"
                size="sm"
                className="border-white/[0.08]"
                onClick={() =>
                  onViewTrackDayLeaderboard(
                    section.trackDayId!,
                    customTitle || kindLabel
                  )
                }
              >
                <Trophy className="size-3.5" />
                Leaderboard
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
