"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Trophy,
  Medal,
  ChevronDown,
  ChevronUp,
  User,
} from "lucide-react";
import type { LeaderboardEntry, WorkoutType } from "@/types/crossfit";
import { WORKOUT_TYPE_LABELS } from "@/types/crossfit";

// ============================================
// Props
// ============================================

interface LeaderboardProps {
  workoutTitle?: string;
  workoutType: WorkoutType;
  entries: LeaderboardEntry[];
}

// ============================================
// Helpers
// ============================================

const DIVISION_STYLES = {
  rx: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  scaled: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  rx_plus: "bg-purple-500/20 text-purple-400 border-purple-500/30",
} as const;

const DIVISION_LABELS = {
  rx: "Rx",
  scaled: "Scaled",
  rx_plus: "Rx+",
} as const;

function getRankIcon(rank: number) {
  switch (rank) {
    case 1:
      return <Trophy className="size-4 text-yellow-400" />;
    case 2:
      return <Medal className="size-4 text-zinc-300" />;
    case 3:
      return <Medal className="size-4 text-amber-600" />;
    default:
      return (
        <span className="flex size-5 items-center justify-center text-xs font-mono text-muted-foreground">
          {rank}
        </span>
      );
  }
}

// ============================================
// LeaderboardRow
// ============================================

function LeaderboardRow({
  entry,
  rank,
}: {
  entry: LeaderboardEntry;
  rank: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails =
    entry.scalingDetails && entry.scalingDetails.some((s) => !s.wasRx);

  return (
    <div>
      <button
        type="button"
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
          hasDetails ? "hover:bg-muted/50 cursor-pointer" : "cursor-default"
        } ${rank <= 3 ? "bg-muted/20" : ""}`}
      >
        {/* Rank */}
        <div className="flex w-8 shrink-0 items-center justify-center">
          {getRankIcon(rank)}
        </div>

        {/* Name */}
        <div className="flex flex-1 items-center gap-2 min-w-0">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
            <User className="size-3.5 text-muted-foreground" />
          </div>
          <span className="truncate text-sm font-medium">
            {entry.userName}
          </span>
        </div>

        {/* Score */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-foreground">
            {entry.displayScore}
          </span>
          <Badge
            variant="outline"
            className={`text-[10px] ${DIVISION_STYLES[entry.division]}`}
          >
            {DIVISION_LABELS[entry.division]}
          </Badge>
          {entry.hitTimeCap && (
            <Badge
              variant="outline"
              className="text-[10px] bg-red-500/10 text-red-400 border-red-500/30"
            >
              CAP
            </Badge>
          )}
        </div>

        {/* Expand indicator */}
        {hasDetails && (
          <div className="shrink-0">
            {expanded ? (
              <ChevronUp className="size-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="size-4 text-muted-foreground" />
            )}
          </div>
        )}
      </button>

      {/* Expanded details */}
      {expanded && entry.scalingDetails && (
        <div className="ml-11 mb-2 space-y-1 rounded-lg bg-muted/30 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
            Scaling Details
          </p>
          {entry.scalingDetails.map((detail, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between text-xs"
            >
              <span className="text-muted-foreground">
                {detail.movementName}
              </span>
              <div className="flex items-center gap-2">
                {detail.wasRx ? (
                  <Badge
                    variant="outline"
                    className="text-[9px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                  >
                    Rx
                  </Badge>
                ) : (
                  <span className="text-yellow-400">
                    {detail.modification && (
                      <span>{detail.modification}</span>
                    )}
                    {detail.actualWeight && (
                      <span> @ {detail.actualWeight} lb</span>
                    )}
                    {detail.substitutionName && (
                      <span> &rarr; {detail.substitutionName}</span>
                    )}
                  </span>
                )}
              </div>
            </div>
          ))}
          {entry.rpe && (
            <div className="flex items-center justify-between text-xs pt-1 border-t border-border/30">
              <span className="text-muted-foreground">RPE</span>
              <span className="font-mono">{entry.rpe}/10</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// Component
// ============================================

export function Leaderboard({
  workoutTitle,
  workoutType,
  entries,
}: LeaderboardProps) {
  const [filter, setFilter] = useState<"all" | "rx" | "scaled">("all");

  const filteredEntries = entries.filter((entry) => {
    if (filter === "all") return true;
    if (filter === "rx") return entry.division === "rx" || entry.division === "rx_plus";
    return entry.division === "scaled";
  });

  // Sort entries: better scores first
  const sortedEntries = [...filteredEntries].sort((a, b) => {
    // For time-based: lower is better. For reps/load: higher is better.
    if (workoutType === "for_time") {
      // Non-cap entries first, then by time ascending
      if (a.hitTimeCap !== b.hitTimeCap) return a.hitTimeCap ? 1 : -1;
      return a.sortValue - b.sortValue;
    }
    // For everything else, higher is better
    return b.sortValue - a.sortValue;
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="space-y-1">
        <h3 className="text-base font-semibold flex items-center gap-2">
          <Trophy className="size-4 text-primary" />
          Leaderboard
        </h3>
        {workoutTitle && (
          <p className="text-xs text-muted-foreground">
            {workoutTitle} &middot; {WORKOUT_TYPE_LABELS[workoutType]}
          </p>
        )}
      </div>

      {/* Filter Tabs */}
      <Tabs value={filter} onValueChange={(val) => setFilter(val as typeof filter)}>
        <TabsList>
          <TabsTrigger value="all">
            All ({entries.length})
          </TabsTrigger>
          <TabsTrigger value="rx">
            Rx ({entries.filter((e) => e.division === "rx" || e.division === "rx_plus").length})
          </TabsTrigger>
          <TabsTrigger value="scaled">
            Scaled ({entries.filter((e) => e.division === "scaled").length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value={filter}>
          <div className="mt-2 space-y-0.5">
            {sortedEntries.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/50 p-8 text-center text-sm text-muted-foreground">
                No scores logged yet
              </div>
            ) : (
              sortedEntries.map((entry, idx) => (
                <div key={entry.scoreId}>
                  <LeaderboardRow entry={entry} rank={idx + 1} />
                  {idx < sortedEntries.length - 1 && (
                    <Separator className="opacity-30" />
                  )}
                </div>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
