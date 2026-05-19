"use client";

import { ReactNode } from "react";
import { Trophy } from "lucide-react";
import type {
  WorkoutSectionDisplay,
  WorkoutSectionKindDisplay,
} from "@/types/crossfit";
import { Button } from "@/components/ui/button";
import { TrackDayScoreInput } from "@/components/crossfit/track-day-score-input";
import type { TrackScoringConfig } from "@/types/programming-tracks";

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
  onViewTrackDayLeaderboard,
}: {
  section: WorkoutSectionDisplay;
  children: ReactNode;
  /** Optional handler for free-form track-day sections — opens a
   *  community leaderboard for that day's scores. Hidden in personal
   *  view (where the parent doesn't pass the handler). */
  onViewTrackDayLeaderboard?: (trackDayId: string, title: string) => void;
}) {
  const kindLabel = LABELS[section.kind];
  const customTitle = section.title?.trim();
  const body = section.body?.trim();
  const hasParts = (section.partIds?.length ?? 0) > 0;
  const isFreeFormTrackDay =
    !!section.sourceTrackId && !!section.trackDayId && !hasParts;
  return (
    <section className="space-y-3 rounded-lg border border-white/[0.05] bg-white/[0.02] p-3">
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-xs font-bold uppercase tracking-wider text-primary">
          {kindLabel}
        </h3>
        {customTitle ? (
          <span className="text-sm font-semibold text-foreground/90">
            {customTitle}
          </span>
        ) : null}
      </header>
      {body ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
          {body}
        </p>
      ) : null}
      <div className="space-y-3">{children}</div>
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
