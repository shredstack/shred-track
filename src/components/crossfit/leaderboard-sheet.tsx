"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LeaderboardShell } from "@/components/crossfit/leaderboard-shell";
import { Leaderboard } from "@/components/crossfit/leaderboard";
import { ScoreCommentsDrawer } from "@/components/crossfit/score-comments-drawer";
import { useLeaderboard } from "@/hooks/useLeaderboard";
import type { WorkoutDisplay, WorkoutPartDisplay } from "@/types/crossfit";

interface LeaderboardSheetProps {
  workout: WorkoutDisplay | null;
  onOpenChange: (open: boolean) => void;
  /** Controlled: which score's comments drawer is open. The parent owns
   *  this state so notification deep-links can pre-open it without the
   *  sheet keeping its own copy. */
  commentScoreId: string | null;
  onCommentScoreIdChange: (id: string | null) => void;
}

// Per-part display label for the tab strip / single-part header. Priority:
//   1. The part's own label (coach-set, e.g. "Bench Press 5RM").
//   2. The section title the part belongs to — gives "WOD" / "Strength" /
//      etc. when the coach has typed sections set up.
//   3. "Part A" / "Part B" fallback for legacy workouts with no metadata.
function partTabLabel(
  part: WorkoutPartDisplay,
  index: number,
  sectionTitleByPartId: Map<string, string>
): string {
  const own = part.label?.trim();
  if (own) return own;
  const fromSection = sectionTitleByPartId.get(part.id)?.trim();
  if (fromSection) return fromSection;
  return `Part ${String.fromCharCode(65 + index)}`;
}

export function LeaderboardSheet({
  workout,
  onOpenChange,
  commentScoreId,
  onCommentScoreIdChange,
}: LeaderboardSheetProps) {
  const workoutId = workout?.id ?? null;

  // Parts ordered for the tab strip. Multi-part workouts get a tab per part;
  // single-part workouts render the leaderboard without a tab strip.
  const parts = useMemo(
    () =>
      [...(workout?.parts ?? [])].sort(
        (a, b) => a.orderIndex - b.orderIndex
      ),
    [workout]
  );

  // Map part id → owning section title (when the workout has typed
  // sections). Used by partTabLabel so tabs read "WOD" / "Strength"
  // instead of the generic "Part A" when the part has no own label.
  const sectionTitleByPartId = useMemo(() => {
    const map = new Map<string, string>();
    const sections = workout?.sections ?? [];
    for (const section of sections) {
      if (!section.title?.trim()) continue;
      // When multiple parts share a section, suffix with "A/B/..." so
      // tabs disambiguate. When it's the only part in its section, just
      // use the section title verbatim.
      if (section.partIds.length === 1) {
        map.set(section.partIds[0], section.title);
      } else {
        section.partIds.forEach((pid, i) => {
          map.set(pid, `${section.title} ${String.fromCharCode(65 + i)}`);
        });
      }
    }
    return map;
  }, [workout]);

  const [activePartId, setActivePartId] = useState<string | null>(
    parts[0]?.id ?? null
  );

  // When the sheet re-opens for a different workout, reset the active tab
  // by remounting via a key.
  const sheetKey = workoutId ?? "closed";

  const { data, isLoading, error } = useLeaderboard(workoutId);

  // For the comments drawer header — find the row whose score is being
  // commented on. Cheap lookup across all parts.
  const commentRow = useMemo(() => {
    if (!commentScoreId || !data) return null;
    for (const entries of Object.values(data.parts)) {
      const hit = entries.find((e) => e.scoreId === commentScoreId);
      if (hit) return hit;
    }
    return null;
  }, [commentScoreId, data]);

  const currentPartId =
    activePartId && parts.some((p) => p.id === activePartId)
      ? activePartId
      : parts[0]?.id ?? null;

  const open = !!workout;

  // Subtitle in the full-screen header. For single-part workouts we
  // promote the part/section label into the subtitle so the leaderboard
  // header reads "Bench 5RM" or "WOD" instead of just a date.
  const headerSubtitle = useMemo(() => {
    if (!workout) return null;
    const dateLabel = workout.workoutDate
      ? new Date(workout.workoutDate).toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        })
      : null;
    if (parts.length === 1) {
      const label = partTabLabel(parts[0], 0, sectionTitleByPartId);
      return [label, dateLabel].filter(Boolean).join(" · ");
    }
    return dateLabel;
  }, [workout, parts, sectionTitleByPartId]);

  // The tab strip is only useful when there's more than one part. We
  // strip the cosmetic horizontal scrollbar so users don't mistake it
  // for "scroll to see more athletes" — descriptive labels usually fit
  // on one row anyway.
  const headerExtra =
    parts.length > 1 && currentPartId && workoutId ? (
      <Tabs value={currentPartId} onValueChange={setActivePartId}>
        <TabsList className="no-scrollbar w-full overflow-x-auto">
          {parts.map((p, idx) => (
            <TabsTrigger
              key={p.id}
              value={p.id}
              className="flex-1 whitespace-nowrap"
            >
              {partTabLabel(p, idx, sectionTitleByPartId)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    ) : null;

  return (
    <LeaderboardShell
      open={open}
      onOpenChange={onOpenChange}
      title={workout?.title ?? "Leaderboard"}
      subtitle={headerSubtitle}
      headerExtra={headerExtra}
    >
      <div key={sheetKey}>
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="m-4 rounded-lg border border-dashed border-border/50 p-8 text-center text-sm text-muted-foreground">
            {error.message}
          </div>
        ) : parts.length === 0 ? (
          <div className="m-4 rounded-lg border border-dashed border-border/50 p-8 text-center text-sm text-muted-foreground">
            This workout has no scored parts.
          </div>
        ) : parts.length === 1 && currentPartId && workoutId ? (
          <Leaderboard
            workoutType={parts[0].workoutType}
            entries={data?.parts[currentPartId] ?? []}
            workoutId={workoutId}
            onOpenComments={onCommentScoreIdChange}
          />
        ) : workoutId && currentPartId ? (
          // Multi-part: the Tabs control lives in the sticky header; we
          // render only the active part's body here. (Mounting all
          // TabsContent siblings would double-render the leaderboard.)
          <Leaderboard
            workoutType={
              parts.find((p) => p.id === currentPartId)!.workoutType
            }
            entries={data?.parts[currentPartId] ?? []}
            workoutId={workoutId}
            onOpenComments={onCommentScoreIdChange}
          />
        ) : null}
      </div>

      {workout?.communityId && workoutId && (
        <ScoreCommentsDrawer
          open={!!commentScoreId}
          onOpenChange={(o) => {
            if (!o) onCommentScoreIdChange(null);
          }}
          scoreId={commentScoreId}
          workoutId={workoutId}
          communityId={workout.communityId}
          athleteName={commentRow?.userName}
          workoutTitle={workout.title}
        />
      )}
    </LeaderboardShell>
  );
}
