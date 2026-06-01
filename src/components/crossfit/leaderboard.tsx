"use client";

import { useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LeaderboardRow,
  type WorkoutLeaderboardRowEntry,
} from "@/components/crossfit/leaderboard-row";
import type { LeaderboardEntry, WorkoutType } from "@/types/crossfit";
import { useToggleReaction } from "@/hooks/useLeaderboard";

interface LeaderboardProps {
  workoutType: WorkoutType;
  entries: LeaderboardEntry[];
  /** Workout id — required to scope reaction toggle cache updates. When
   *  omitted, the social affordances are hidden (lets the component be
   *  rendered in a read-only / preview context). */
  workoutId?: string;
  /** Tap a row's comment button to open the comments drawer for that score. */
  onOpenComments?: (scoreId: string) => void;
}

type DivisionFilter = "all" | "rx" | "scaled";

export function Leaderboard({
  workoutType,
  entries,
  workoutId,
  onOpenComments,
}: LeaderboardProps) {
  const [filter, setFilter] = useState<DivisionFilter>("all");
  const toggleReaction = useToggleReaction();

  const counts = useMemo(
    () => ({
      all: entries.length,
      rx: entries.filter((e) => e.division === "rx" || e.division === "rx_plus").length,
      scaled: entries.filter((e) => e.division === "scaled").length,
    }),
    [entries]
  );

  const sortedEntries = useMemo(() => {
    const filtered = entries.filter((entry) => {
      if (filter === "all") return true;
      if (filter === "rx")
        return entry.division === "rx" || entry.division === "rx_plus";
      return entry.division === "scaled";
    });
    return [...filtered].sort((a, b) => {
      if (workoutType === "for_time") {
        if (a.hitTimeCap !== b.hitTimeCap) return a.hitTimeCap ? 1 : -1;
        return a.sortValue - b.sortValue;
      }
      return b.sortValue - a.sortValue;
    });
  }, [entries, filter, workoutType]);

  return (
    <div className="flex flex-col gap-3 pt-3 pb-6">
      <div className="px-4">
        <Tabs
          value={filter}
          onValueChange={(val) => setFilter(val as DivisionFilter)}
        >
          <TabsList className="w-full">
            <TabsTrigger value="all" className="flex-1">
              All ({counts.all})
            </TabsTrigger>
            <TabsTrigger value="rx" className="flex-1">
              Rx ({counts.rx})
            </TabsTrigger>
            <TabsTrigger value="scaled" className="flex-1">
              Scaled ({counts.scaled})
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex flex-col">
        {sortedEntries.length === 0 ? (
          <div className="mx-4 rounded-lg border border-dashed border-border/50 p-8 text-center text-sm text-muted-foreground">
            No scores logged yet
          </div>
        ) : (
          sortedEntries.map((entry, idx) => {
            const row: WorkoutLeaderboardRowEntry = {
              kind: "workout",
              rowId: entry.scoreId,
              userName: entry.userName,
              userUsername: entry.userUsername,
              userImage: entry.userImage,
              displayScore: entry.displayScore,
              createdAt: entry.createdAt,
              division: entry.division,
              hitTimeCap: entry.hitTimeCap,
              rpe: entry.rpe,
              scalingDetails: entry.scalingDetails,
              heaviestAthleteWeightLb: entry.heaviestAthleteWeightLb,
              reactionCount: entry.reactionCount,
              commentCount: entry.commentCount,
              viewerReacted: entry.viewerReacted,
              togglePending: toggleReaction.isPending,
              onToggleReaction: workoutId
                ? () =>
                    toggleReaction.mutate({
                      scoreId: entry.scoreId,
                      workoutId,
                      currentlyReacted: entry.viewerReacted,
                    })
                : undefined,
              onOpenComments: onOpenComments
                ? () => onOpenComments(entry.scoreId)
                : undefined,
            };
            return <LeaderboardRow key={entry.scoreId} entry={row} rank={idx + 1} />;
          })
        )}
      </div>
    </div>
  );
}
