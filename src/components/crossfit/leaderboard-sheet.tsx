"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Leaderboard } from "@/components/crossfit/leaderboard";
import { ScoreCommentsDrawer } from "@/components/crossfit/score-comments-drawer";
import { useLeaderboard } from "@/hooks/useLeaderboard";
import type { WorkoutDisplay } from "@/types/crossfit";

interface LeaderboardSheetProps {
  workout: WorkoutDisplay | null;
  onOpenChange: (open: boolean) => void;
  /** Controlled: which score's comments drawer is open. The parent owns
   *  this state so notification deep-links can pre-open it without the
   *  sheet keeping its own copy. */
  commentScoreId: string | null;
  onCommentScoreIdChange: (id: string | null) => void;
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

  const [activePartId, setActivePartId] = useState<string | null>(
    parts[0]?.id ?? null
  );

  // When the sheet re-opens for a different workout, reset the active tab.
  // Use a key on the inner content so React unmounts/remounts cleanly.
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

  return (
    <Sheet open={!!workout} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[90vh] overflow-y-auto data-[side=bottom]:rounded-t-2xl"
      >
        <SheetHeader>
          <SheetTitle>
            {workout?.title ?? "Leaderboard"}
          </SheetTitle>
          {workout?.workoutDate && (
            <p className="text-xs text-muted-foreground">
              {new Date(workout.workoutDate).toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </p>
          )}
        </SheetHeader>

        <div key={sheetKey} className="px-4 pb-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="rounded-lg border border-dashed border-border/50 p-8 text-center text-sm text-muted-foreground">
              {error.message}
            </div>
          ) : parts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/50 p-8 text-center text-sm text-muted-foreground">
              This workout has no scored parts.
            </div>
          ) : parts.length === 1 && currentPartId && workoutId ? (
            <Leaderboard
              workoutTitle={workout?.title}
              workoutType={parts[0].workoutType}
              entries={data?.parts[currentPartId] ?? []}
              workoutId={workoutId}
              onOpenComments={onCommentScoreIdChange}
            />
          ) : workoutId ? (
            <Tabs
              value={currentPartId ?? undefined}
              onValueChange={setActivePartId}
            >
              <TabsList className="w-full overflow-x-auto">
                {parts.map((p, idx) => (
                  <TabsTrigger
                    key={p.id}
                    value={p.id}
                    className="flex-1 whitespace-nowrap"
                  >
                    {p.label?.trim() || `Part ${idx + 1}`}
                  </TabsTrigger>
                ))}
              </TabsList>
              {parts.map((p) => (
                <TabsContent key={p.id} value={p.id} className="mt-3">
                  <Leaderboard
                    workoutType={p.workoutType}
                    entries={data?.parts[p.id] ?? []}
                    workoutId={workoutId}
                    onOpenComments={onCommentScoreIdChange}
                  />
                </TabsContent>
              ))}
            </Tabs>
          ) : null}
        </div>
      </SheetContent>
      {workout?.communityId && workoutId && (
        <ScoreCommentsDrawer
          open={!!commentScoreId}
          onOpenChange={(open) => {
            if (!open) onCommentScoreIdChange(null);
          }}
          scoreId={commentScoreId}
          workoutId={workoutId}
          communityId={workout.communityId}
          athleteName={commentRow?.userName}
          workoutTitle={workout.title}
        />
      )}
    </Sheet>
  );
}
