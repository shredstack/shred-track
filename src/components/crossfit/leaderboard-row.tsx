"use client";

// Single leaderboard row. Shared between the workout leaderboard (with
// division/scaling/reactions/comments) and the track-day leaderboard
// (numeric value + unit + notes, read-only for v1). The component is
// generic over `kind` and toggles the workout-only affordances behind
// presence checks so the same visual rhythm holds across both surfaces.

import { useState } from "react";
import {
  Trophy,
  Medal,
  ChevronDown,
  ChevronUp,
  User,
  Flame,
  MessageCircle,
  CheckCircle2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// --------------------------------------------------------------
// Shared bits
// --------------------------------------------------------------

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

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(1, Math.round((now - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const m = Math.round(diffSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// --------------------------------------------------------------
// Generic row shape
// --------------------------------------------------------------

export interface BaseLeaderboardRowEntry {
  /** Stable id used for keys. Workout: scoreId. Track day: trackDayScoreId. */
  rowId: string;
  userName: string;
  userUsername?: string | null;
  userImage?: string | null;
  displayScore: string;
  /** Optional secondary line shown under the name (e.g. notes). */
  secondary?: string | null;
  /** ISO timestamp used for the "Nm ago" footer label. */
  createdAt: string;
}

export interface WorkoutLeaderboardRowEntry extends BaseLeaderboardRowEntry {
  kind: "workout";
  division: "rx" | "scaled" | "rx_plus";
  hitTimeCap: boolean;
  rpe?: number;
  scalingDetails?: Array<{
    workoutMovementId: string;
    movementName: string;
    wasRx: boolean;
    actualWeight?: string;
    actualReps?: string;
    modification?: string;
    substitutionName?: string;
  }>;
  // Heaviest weight (lb) the athlete used across rounds on an
  // athlete-picked-weight movement. Set only when the part scores by
  // reps (chip is a secondary signal); null/undefined when the part
  // scores by load (the weight is already in displayScore).
  heaviestAthleteWeightLb?: number | null;
  // Social — workout-only for now.
  reactionCount: number;
  commentCount: number;
  viewerReacted: boolean;
  onToggleReaction?: () => void;
  togglePending?: boolean;
  onOpenComments?: () => void;
}

export interface TrackDayLeaderboardRowEntry extends BaseLeaderboardRowEntry {
  kind: "track_day";
  isComplete: boolean;
  /** Optional notes from the athlete on this day's entry. */
  notes?: string | null;
}

export type LeaderboardRowEntry =
  | WorkoutLeaderboardRowEntry
  | TrackDayLeaderboardRowEntry;

// --------------------------------------------------------------
// Row
// --------------------------------------------------------------

export function LeaderboardRow({
  entry,
  rank,
}: {
  entry: LeaderboardRowEntry;
  rank: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasScalingDetails =
    entry.kind === "workout" &&
    !!entry.scalingDetails &&
    entry.scalingDetails.some((s) => !s.wasRx);
  const hasNotes = entry.kind === "track_day" && !!entry.notes?.trim();
  const expandable = hasScalingDetails || hasNotes;

  return (
    <div className="px-3 sm:px-4">
      <button
        type="button"
        onClick={() => expandable && setExpanded(!expanded)}
        className={`flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors ${
          expandable ? "hover:bg-muted/50 cursor-pointer" : "cursor-default"
        } ${rank <= 3 ? "bg-muted/20" : ""}`}
      >
        <div className="flex w-8 shrink-0 items-center justify-center">
          {getRankIcon(rank)}
        </div>

        <div className="flex flex-1 items-center gap-2 min-w-0">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
            <User className="size-4 text-muted-foreground" />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium leading-tight">
              {entry.userName}
            </span>
            {entry.userUsername && (
              <span className="truncate text-[10px] text-muted-foreground leading-tight">
                @{entry.userUsername}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-foreground">
            {entry.displayScore}
          </span>
          {entry.kind === "workout" && (
            <>
              {entry.heaviestAthleteWeightLb != null && (
                <Badge
                  variant="outline"
                  className="text-[10px] bg-sky-500/10 text-sky-300 border-sky-500/30"
                >
                  {entry.heaviestAthleteWeightLb} lb
                </Badge>
              )}
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
            </>
          )}
          {entry.kind === "track_day" && entry.isComplete && (
            <CheckCircle2 className="size-3.5 text-emerald-400" />
          )}
        </div>

        {expandable && (
          <div className="shrink-0">
            {expanded ? (
              <ChevronUp className="size-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="size-4 text-muted-foreground" />
            )}
          </div>
        )}
      </button>

      {/* Social footer — workout-only for v1. Track-day leaderboard is
          read-only ranks; comments/reactions on track-day scores will
          ship as a follow-up once the social tables are polymorphic. */}
      {entry.kind === "workout" && (entry.onToggleReaction || entry.onOpenComments) && (
        <div className="ml-13 mt-0.5 flex items-center gap-1 pb-1">
          {entry.onToggleReaction && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={`h-7 gap-1 px-2 text-xs ${
                entry.viewerReacted
                  ? "text-orange-400 hover:text-orange-300"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              disabled={entry.togglePending}
              onClick={(e) => {
                e.stopPropagation();
                entry.onToggleReaction?.();
              }}
              aria-pressed={entry.viewerReacted}
              aria-label={entry.viewerReacted ? "Remove fire" : "Add fire"}
            >
              <Flame
                className={`size-3.5 ${
                  entry.viewerReacted ? "fill-orange-400/40" : ""
                }`}
              />
              {entry.reactionCount > 0 && <span>{entry.reactionCount}</span>}
            </Button>
          )}
          {entry.onOpenComments && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                entry.onOpenComments?.();
              }}
              aria-label="Open comments"
            >
              <MessageCircle className="size-3.5" />
              {entry.commentCount > 0 && <span>{entry.commentCount}</span>}
            </Button>
          )}
          <span className="ml-auto pr-2 text-[10px] text-muted-foreground">
            {relativeTime(entry.createdAt)}
          </span>
        </div>
      )}

      {/* Track-day: timestamp + secondary line (notes preview when not expanded) */}
      {entry.kind === "track_day" && (
        <div className="ml-13 mt-0.5 flex items-center gap-1 pb-2">
          <span className="ml-auto pr-2 text-[10px] text-muted-foreground">
            {relativeTime(entry.createdAt)}
          </span>
        </div>
      )}

      {/* Expanded details */}
      {expanded && entry.kind === "workout" && entry.scalingDetails && (
        <div className="ml-13 mb-2 space-y-1 rounded-lg bg-muted/30 p-3">
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

      {expanded && entry.kind === "track_day" && entry.notes && (
        <div className="ml-13 mb-2 rounded-lg bg-muted/30 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
            Notes
          </p>
          <p className="whitespace-pre-wrap text-xs text-foreground/90">
            {entry.notes}
          </p>
        </div>
      )}
    </div>
  );
}
