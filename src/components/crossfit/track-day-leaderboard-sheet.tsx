"use client";

// Full-screen leaderboard for non-WOD track days (monthly challenges,
// custom-track day inputs). Mirrors the workout LeaderboardSheet but
// reads from /api/track-days/[id]/leaderboard and renders rows without
// division/scaling. v1 is read-only — no reactions/comments on
// track-day scores yet.

import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { LeaderboardShell } from "@/components/crossfit/leaderboard-shell";
import {
  LeaderboardRow,
  type TrackDayLeaderboardRowEntry,
} from "@/components/crossfit/leaderboard-row";
import { useTrackDayLeaderboard } from "@/hooks/useTracks";

interface TrackDayLeaderboardSheetProps {
  /** When non-null the sheet is open and fetches the leaderboard. */
  trackDayId: string | null;
  /** Display title shown in the header. Typically "{trackName} — Day N". */
  title: string;
  /** Optional subtitle (e.g. the day's date or section label). */
  subtitle?: string | null;
  onOpenChange: (open: boolean) => void;
}

export function TrackDayLeaderboardSheet({
  trackDayId,
  title,
  subtitle,
  onOpenChange,
}: TrackDayLeaderboardSheetProps) {
  const open = !!trackDayId;
  const { data, isLoading, error } = useTrackDayLeaderboard(trackDayId);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.entries.map((e): TrackDayLeaderboardRowEntry => ({
      kind: "track_day",
      rowId: e.scoreId,
      userName: e.userName,
      userUsername: e.userUsername,
      userImage: e.userImage,
      displayScore: e.displayScore,
      createdAt: e.createdAt,
      isComplete: e.isComplete,
      notes: e.notes,
    }));
  }, [data]);

  // Subtitle: for cumulative leaderboards, the per-day date is misleading
  // (the ranking is summed across the whole track), so always show
  // "Cumulative totals". Otherwise, prefer the caller's prop (which knows
  // the day-number context); fall back to the date the API returns.
  const finalSubtitle = data?.isCumulative
    ? "Cumulative totals"
    : subtitle ??
      (data?.dayDate
        ? new Date(`${data.dayDate}T00:00:00`).toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          })
        : null);

  return (
    <LeaderboardShell
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      subtitle={finalSubtitle}
    >
      <div className="py-3 pb-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="m-4 rounded-lg border border-dashed border-border/50 p-8 text-center text-sm text-muted-foreground">
            {error.message}
          </div>
        ) : rows.length === 0 ? (
          <div className="m-4 rounded-lg border border-dashed border-border/50 p-8 text-center text-sm text-muted-foreground">
            No scores logged yet
          </div>
        ) : (
          <div className="flex flex-col">
            {rows.map((row, idx) => (
              <LeaderboardRow key={row.rowId} entry={row} rank={idx + 1} />
            ))}
          </div>
        )}
      </div>
    </LeaderboardShell>
  );
}
