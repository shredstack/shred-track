"use client";

import Link from "next/link";
import { Building2, MoreVertical, Pencil, Send, Shield, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WorkoutSectionBlock } from "@/components/crossfit/workout-section-block";
import { PartSection } from "@/components/crossfit/workout-card";
import { CalorieBadge } from "@/components/crossfit/calorie-badge";
import { BenchmarkPrPill } from "@/components/crossfit/benchmark-pr-pill";
import type { WorkoutDisplay } from "@/types/crossfit";

interface ProgrammedWorkoutDayProps {
  workout: WorkoutDisplay;
  /** Open the score modal for a specific section. The page derives the
   *  parts filter from the section's partIds. */
  onLogScore?: (workoutId: string, sectionId: string) => void;
  /** Open the leaderboard sheet scoped to a section. */
  onViewLeaderboard?: (workoutId: string, sectionId: string) => void;
  onViewTrackDayLeaderboard?: (trackDayId: string, title: string) => void;
  /** Coach action: jump to /gym/programming/[weekStart] to edit this
   *  workout. Same data as the inline view, just the richer editor. */
  onEditInProgramming?: () => void;
  onDelete?: (workoutId: string) => Promise<void> | void;
  onMoveToGym?: (workoutId: string) => Promise<void> | void;
  moveToGymName?: string;
}

// Monday of the week containing `iso` (YYYY-MM-DD). Mirrors mondayOf in
// the programming API routes so the "Edit in programming admin" link
// resolves to the same release the workout belongs to.
function mondayOfWeek(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/**
 * Day view for programming-published workouts. Replaces the outer
 * `<WorkoutCard>` wrapper with a slim day header (gym, calories, kebab)
 * plus a stack of section cards. Personal / non-sectioned workouts keep
 * rendering through `<WorkoutCard>`.
 */
export function ProgrammedWorkoutDay({
  workout,
  onLogScore,
  onViewLeaderboard,
  onViewTrackDayLeaderboard,
  onEditInProgramming,
  onDelete,
  onMoveToGym,
  moveToGymName,
}: ProgrammedWorkoutDayProps) {
  const parts = workout.parts ?? [];
  const sections = [...(workout.sections ?? [])].sort(
    (a, b) => a.position - b.position
  );
  const showKebab = !!(onEditInProgramming || onDelete || onMoveToGym);
  const weekStart = mondayOfWeek(workout.workoutDate);
  // Programming admin deep-link. The page resolves the gym from the
  // user's active community (no communityId segment in the URL), so we
  // only need the weekStart. It gates on coach/admin permissions, so
  // non-admins who somehow trigger the link land on a 403.
  const programmingHref = workout.communityId
    ? `/gym/programming/${weekStart}`
    : null;

  // Orphan parts (no section assignment) trail under "Other". Rare —
  // exists only when a section was deleted without reassigning its
  // parts, or for legacy data from before sections existed.
  const usedPartIds = new Set(sections.flatMap((s) => s.partIds));
  const orphanParts = parts.filter((p) => !usedPartIds.has(p.id));

  // Workout-level metadata (description, partner, vest) describes the
  // *scored* part of the day — not the warm-up or stretching that book-end
  // it. Attach the chips/blurb to the section that owns the WOD: prefer the
  // section tagged with a benchmark, fall back to the first WOD-kind
  // section, then any scored section. When nothing matches (rare: a day
  // with only warm-up / stretching) we drop the metadata silently since
  // there's no scored context to hang it off of.
  const ownerSectionId =
    sections.find((s) => !!s.benchmarkWorkoutId)?.id ??
    sections.find((s) => s.kind === "wod")?.id ??
    sections.find((s) => s.isScored)?.id ??
    null;
  const hasOwnerMetadata =
    !!ownerSectionId &&
    (!!workout.description || workout.isPartner || workout.requiresVest);

  return (
    <div className="space-y-3">
      {/* Day header strip — slim, non-Card. Carries gym branding,
          calorie chip, and admin kebab. Workout title is intentionally
          omitted; the WOD section's own title acts as the day's name. */}
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-2">
          {workout.communityId && workout.communityName ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {workout.communityLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={workout.communityLogoUrl}
                  alt=""
                  className="h-4 w-4 rounded object-contain"
                />
              ) : (
                <Building2 className="h-3.5 w-3.5" />
              )}
              <span className="truncate">{workout.communityName}</span>
            </div>
          ) : null}
          {workout.estimatedKcalLow != null &&
          workout.estimatedKcalHigh != null ? (
            <>
              <span className="text-muted-foreground/40">·</span>
              <CalorieBadge
                variant="detail"
                low={workout.estimatedKcalLow}
                high={workout.estimatedKcalHigh}
                confidence={workout.estimatedKcalConfidence}
              />
            </>
          ) : null}
        </div>
        {showKebab ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-muted-foreground"
                  aria-label="Day actions"
                />
              }
            >
              <MoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {onEditInProgramming && programmingHref ? (
                <DropdownMenuItem
                  render={<Link href={programmingHref} />}
                >
                  <Pencil className="size-3.5" />
                  Edit in programming admin
                </DropdownMenuItem>
              ) : null}
              {onMoveToGym ? (
                <DropdownMenuItem onClick={() => onMoveToGym(workout.id)}>
                  <Send className="size-3.5" />
                  Move to {moveToGymName ?? "another gym"}
                </DropdownMenuItem>
              ) : null}
              {onDelete ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onDelete(workout.id)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                    Delete workout
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {/* One standalone card per section. */}
      {sections.map((section) => {
        const sectionParts = section.partIds
          .map((pid) => parts.find((p) => p.id === pid))
          .filter((p): p is (typeof parts)[number] => !!p);
        const sectionHasParts = sectionParts.length > 0;
        const sectionHasScore = sectionParts.some((p) => p.score);
        // Any section with Smart-Builder parts is scoreable. The
        // `is_scored` field is currently never set by the programming
        // admin (the toggle isn't exposed in the UI), so gating on it
        // would hide the button on every published section.
        // TrackDayScoreInput only renders for *free-form* track sections
        // (no parts) — so parts-based track sessions (built via Smart
        // Builder on a track day) need the regular Log Score CTA too.
        const showSectionScoring = sectionHasParts && !!onLogScore;
        const showSectionLeaderboard =
          showSectionScoring && !!onViewLeaderboard && !!workout.communityId;
        const isOwnerSection = hasOwnerMetadata && section.id === ownerSectionId;
        return (
          <WorkoutSectionBlock
            key={section.id}
            section={section}
            variant="standalone"
            onViewTrackDayLeaderboard={onViewTrackDayLeaderboard}
            onLogScore={
              showSectionScoring
                ? () => onLogScore?.(workout.id, section.id)
                : undefined
            }
            onViewLeaderboard={
              showSectionLeaderboard
                ? () => onViewLeaderboard?.(workout.id, section.id)
                : undefined
            }
            sectionHasScore={sectionHasScore}
            sectionIsMultiPart={sectionParts.length > 1}
          >
            {section.benchmarkWorkoutId && (
              <div className="-mt-1 flex flex-wrap gap-2">
                <BenchmarkPrPill
                  benchmarkWorkoutId={section.benchmarkWorkoutId}
                  fallbackName={section.title ?? undefined}
                />
              </div>
            )}
            {isOwnerSection && workout.description && (
              <p className="whitespace-pre-wrap text-sm italic leading-relaxed text-muted-foreground">
                {workout.description}
              </p>
            )}
            {isOwnerSection &&
              (workout.requiresVest || workout.isPartner) && (
                <div className="flex flex-wrap items-center gap-3">
                  {workout.requiresVest && (
                    <div className="flex items-center gap-1.5 text-[11px] text-amber-300/90">
                      <Shield className="size-3.5" />
                      <span>
                        {workout.vestWeightMaleLb || workout.vestWeightFemaleLb
                          ? `${workout.vestWeightMaleLb ?? "?"}/${
                              workout.vestWeightFemaleLb ?? "?"
                            } lb vest required`
                          : "Weighted vest required"}
                      </span>
                    </div>
                  )}
                  {workout.isPartner && (
                    <div className="flex items-center gap-1.5 text-[11px] text-cyan-300/90">
                      <Users className="size-3.5" />
                      <span>
                        Partner workout
                        {workout.partnerCount && workout.partnerCount > 2
                          ? ` (${workout.partnerCount}-person team)`
                          : ""}
                      </span>
                    </div>
                  )}
                </div>
              )}
            {sectionHasParts
              ? sectionParts.map((part, idx) => (
                  <div key={part.id} className="space-y-3">
                    {idx > 0 && (
                      <div className="border-t border-border/60" />
                    )}
                    <PartSection
                      part={part}
                      index={idx}
                      showLabel={sectionParts.length > 1}
                      communityId={workout.communityId}
                    />
                  </div>
                ))
              : // Sections without Smart Builder parts (warm-up,
                // stretching, freeform pre-skill, etc.) carry their
                // prescription in `body`, which WorkoutSectionBlock
                // already renders. No placeholder needed when body is
                // present; only show "Empty" when both are missing —
                // and even then, keep it silent for athletes since the
                // coach editing view is where that signal belongs.
                null}
          </WorkoutSectionBlock>
        );
      })}

      {/* Orphans get their own minimal card so they're not lost. */}
      {orphanParts.length > 0 && (
        <div className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Other
          </h3>
          {orphanParts.map((part, idx) => (
            <div key={part.id} className="space-y-3">
              {idx > 0 && <div className="border-t border-border/60" />}
              <PartSection
                part={part}
                index={idx}
                showLabel={orphanParts.length > 1}
                communityId={workout.communityId}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
