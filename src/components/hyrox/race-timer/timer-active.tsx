"use client";

import { useCallback, useEffect, useState } from "react";
import { Pause, Play, Square, ChevronRight } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { setRaceMode } from "@/hooks/useRaceMode";
import type { RaceSegment, TimerStatus } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const tenths = Math.floor((totalSeconds * 10) % 10);
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${tenths}`;
}

function formatMsLong(ms: number): string {
  const totalSeconds = Math.max(0, ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const tenths = Math.floor((totalSeconds * 10) % 10);
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${tenths}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${tenths}`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TimerActiveProps {
  status: TimerStatus;
  segments: RaceSegment[];
  currentSegmentIndex: number;
  segmentElapsedMs: number;
  totalElapsedMs: number;
  completedCount: number;
  onSplit: () => void;
  onPause: () => void;
  onResume: () => void;
  onEndRace: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TimerActive({
  status,
  segments,
  currentSegmentIndex,
  segmentElapsedMs,
  totalElapsedMs,
  completedCount,
  onSplit,
  onPause,
  onResume,
  onEndRace,
}: TimerActiveProps) {
  const [showEndConfirm, setShowEndConfirm] = useState(false);

  const currentSegment = segments[currentSegmentIndex];
  const nextSegment =
    currentSegmentIndex + 1 < segments.length
      ? segments[currentSegmentIndex + 1]
      : null;
  const isLastSegment = currentSegmentIndex === segments.length - 1;
  const totalSegments = segments.length;
  const progressPercent = (completedCount / totalSegments) * 100;

  const isRun = currentSegment?.segmentType === "run";
  const accentColor = isRun ? "text-blue-400" : "text-orange-400";
  const accentBg = isRun ? "bg-blue-500" : "bg-orange-500";

  // Lock to portrait while racing. Unsupported on iOS Safari browser mode —
  // fails silently there. Works in Android Chrome and in installed PWAs.
  useEffect(() => {
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (o: "portrait" | "landscape" | "any") => Promise<void>;
    };
    orientation.lock?.("portrait").catch(() => {});
    return () => {
      try {
        screen.orientation?.unlock?.();
      } catch {}
    };
  }, []);

  // Hide the app's bottom nav while the race is running so it can't be tapped
  // accidentally and doesn't cover the pause / end race controls.
  useEffect(() => {
    setRaceMode(true);
    return () => setRaceMode(false);
  }, []);

  const handleEndRace = useCallback(() => {
    if (showEndConfirm) {
      onEndRace();
      setShowEndConfirm(false);
    } else {
      setShowEndConfirm(true);
    }
  }, [showEndConfirm, onEndRace]);

  const isPaused = status === "paused";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background select-none overflow-y-auto">
     <div
       className="mx-auto flex w-full max-w-lg flex-1 flex-col"
       style={{
         paddingTop: "env(safe-area-inset-top)",
         paddingBottom: "env(safe-area-inset-bottom)",
       }}
     >
      {/* Top bar — segment counter */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
          Segment {completedCount + 1} of {totalSegments}
        </span>
        <span className={`text-xs font-bold uppercase tracking-wider ${accentColor}`}>
          {isRun ? "RUN" : "STATION"}
        </span>
      </div>

      {/* Current segment label */}
      <div className="px-6 pb-2">
        <h2 className={`text-xl font-bold ${accentColor}`}>
          {currentSegment?.label}
        </h2>
        {currentSegment && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {currentSegment.distance}
            {currentSegment.reps ? `${currentSegment.reps} reps` : ""}
            {currentSegment.weightLabel
              ? ` @ ${currentSegment.weightLabel}`
              : ""}
          </p>
        )}
      </div>

      {/* Main time display */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 -mt-4 landscape:mt-0">
        {/* Segment time — primary */}
        <div className="text-center">
          <span className="text-[64px] landscape:text-[44px] leading-none font-mono font-bold tracking-tight tabular-nums">
            {formatMs(segmentElapsedMs)}
          </span>
          <p className="text-xs text-muted-foreground mt-1">segment time</p>
        </div>

        {/* Total elapsed — secondary */}
        <div className="mt-4 landscape:mt-2 text-center">
          <span className="text-2xl landscape:text-xl font-mono font-medium text-muted-foreground tabular-nums">
            {formatMsLong(totalElapsedMs)}
          </span>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            total elapsed
          </p>
        </div>
      </div>

      {/* Next up preview */}
      {nextSegment && (
        <div className="mx-4 mb-3 rounded-xl bg-white/[0.04] border border-white/[0.06] px-4 py-3">
          <div className="flex items-center gap-2">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
              Next up
            </span>
          </div>
          <p className="text-sm font-medium mt-1">
            {nextSegment.label}
            <span className="text-xs text-muted-foreground ml-2">
              {nextSegment.distance}
              {nextSegment.reps ? `${nextSegment.reps} reps` : ""}
              {nextSegment.weightLabel ? ` @ ${nextSegment.weightLabel}` : ""}
            </span>
          </p>
        </div>
      )}

      {/* SPLIT / NEXT button — the giant tap target */}
      {!isPaused && (
        <div className="px-4 mb-3">
          <button
            onClick={onSplit}
            className={`w-full rounded-2xl py-6 landscape:py-4 text-xl landscape:text-lg font-bold text-white shadow-lg active:scale-[0.97] transition-all duration-100 ${accentBg} ${
              isLastSegment ? "shadow-orange-500/25" : "shadow-blue-500/25"
            }`}
          >
            {isLastSegment ? "FINISH RACE" : "SPLIT / NEXT ▶"}
          </button>
        </div>
      )}

      {/* Paused overlay */}
      {isPaused && (
        <div className="px-4 mb-3">
          <button
            onClick={onResume}
            className="w-full rounded-2xl bg-emerald-600 py-6 landscape:py-4 text-xl landscape:text-lg font-bold text-white shadow-lg shadow-emerald-500/25 active:scale-[0.97] transition-all duration-100"
          >
            <span className="flex items-center justify-center gap-2">
              <Play className="h-6 w-6" />
              RESUME
            </span>
          </button>
        </div>
      )}

      {/* Bottom controls */}
      <div className="px-4 pb-3 flex items-center gap-3">
        {/* Pause / Resume toggle */}
        {!isPaused ? (
          <button
            onClick={onPause}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-white/[0.06] border border-white/[0.08] py-3 text-xs font-medium text-muted-foreground hover:bg-white/[0.1] active:scale-[0.97] transition-all"
          >
            <Pause className="h-4 w-4" />
            Pause
          </button>
        ) : (
          <div className="flex-1" />
        )}

        {/* End Race */}
        <button
          onClick={handleEndRace}
          className={`flex-1 flex items-center justify-center gap-2 rounded-xl border py-3 text-xs font-medium active:scale-[0.97] transition-all ${
            showEndConfirm
              ? "bg-red-500/15 border-red-500/30 text-red-400"
              : "bg-white/[0.06] border-white/[0.08] text-muted-foreground hover:bg-white/[0.1]"
          }`}
        >
          <Square className="h-4 w-4" />
          {showEndConfirm ? "Confirm End" : "End Race"}
        </button>
      </div>

      {/* Progress bar */}
      <div className="px-4 pb-4">
        <Progress value={progressPercent} className="h-2" />
        <div className="flex items-center justify-between mt-1.5 text-[10px] text-muted-foreground">
          <span>
            {completedCount} of {totalSegments} completed
          </span>
          <span>{Math.round(progressPercent)}%</span>
        </div>
      </div>
     </div>
    </div>
  );
}
