"use client";

import { useState, useMemo } from "react";
import {
  Trophy,
  Footprints,
  Dumbbell,
  Save,
  RotateCcw,
  ArrowLeft,
  Star,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { CompletedSegment, RaceTemplate } from "./types";

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

interface TimerCompleteProps {
  completedSegments: CompletedSegment[];
  totalTimeMs: number;
  template: RaceTemplate;
  divisionKey: string;
  /** Whether the user is logged in */
  isLoggedIn: boolean;
  /** Called when user wants to save results (logged-in only) */
  onSave: (
    title: string,
    notes: string,
    raceType: "practice" | "actual",
  ) => Promise<void>;
  /** Called when user wants to start a new race */
  onNewRace: () => void;
  /** Called when user wants to go back to setup */
  onBack: () => void;
  /** Station names that are personal bests (after save) */
  personalBests?: string[];
  /** Whether save is in progress */
  isSaving?: boolean;
  /** Whether save succeeded */
  saved?: boolean;
  /** ID of the saved race (if any), used for the post-save link to detail page. */
  savedRaceId?: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TimerComplete({
  completedSegments,
  totalTimeMs,
  template,
  divisionKey,
  isLoggedIn,
  onSave,
  onNewRace,
  onBack,
  personalBests = [],
  isSaving = false,
  saved = false,
  savedRaceId = null,
}: TimerCompleteProps) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [raceType, setRaceType] = useState<"practice" | "actual">("practice");

  const runSegments = useMemo(
    () => completedSegments.filter((s) => s.segmentType === "run"),
    [completedSegments],
  );
  const stationSegments = useMemo(
    () => completedSegments.filter((s) => s.segmentType === "station"),
    [completedSegments],
  );
  const totalRunMs = useMemo(
    () => runSegments.reduce((sum, s) => sum + s.timeMs, 0),
    [runSegments],
  );
  const totalStationMs = useMemo(
    () => stationSegments.reduce((sum, s) => sum + s.timeMs, 0),
    [stationSegments],
  );

  // Find slowest and fastest stations
  const sortedStations = useMemo(
    () => [...stationSegments].sort((a, b) => b.timeMs - a.timeMs),
    [stationSegments],
  );
  const slowest = sortedStations[0];
  const fastest = sortedStations[sortedStations.length - 1];

  const handleSave = () => {
    onSave(title || "Practice Race", notes, raceType);
  };

  return (
    <div className="flex flex-col gap-4 pb-8">
      {/* Finish banner */}
      <div className="text-center pt-6 pb-2">
        <div className="flex items-center justify-center gap-2 mb-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15">
            <Trophy className="h-6 w-6 text-primary" />
          </div>
        </div>
        <h1 className="text-xl font-bold">Race Complete!</h1>
        <p className="text-4xl font-mono font-bold tracking-tight mt-2 tabular-nums">
          {formatMsLong(totalTimeMs)}
        </p>
      </div>

      {/* Run / Station breakdown */}
      <div className="grid grid-cols-2 gap-3 px-1">
        <Card>
          <CardContent className="py-3 text-center">
            <Footprints className="h-4 w-4 text-blue-400 mx-auto mb-1" />
            <p className="text-lg font-mono font-bold tabular-nums">
              {formatMs(totalRunMs)}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Running ({runSegments.length} segments)
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <Dumbbell className="h-4 w-4 text-orange-400 mx-auto mb-1" />
            <p className="text-lg font-mono font-bold tabular-nums">
              {formatMs(totalStationMs)}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Stations ({stationSegments.length} segments)
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Insights */}
      {stationSegments.length > 1 && (
        <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-xs">
          <div>
            <span className="text-muted-foreground">Slowest station: </span>
            <span className="font-medium text-red-400">
              {slowest?.label} ({formatMs(slowest?.timeMs ?? 0)})
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Fastest: </span>
            <span className="font-medium text-emerald-400">
              {fastest?.label} ({formatMs(fastest?.timeMs ?? 0)})
            </span>
          </div>
        </div>
      )}

      {/* Full split list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold">Split Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-0.5">
            {completedSegments.map((seg, i) => {
              const isRun = seg.segmentType === "run";
              const isPB = personalBests.includes(seg.label);
              const bgColor = isRun
                ? "bg-blue-500/[0.06]"
                : "bg-orange-500/[0.06]";
              const iconColor = isRun ? "text-blue-400" : "text-orange-400";
              const cumulative = completedSegments
                .slice(0, i + 1)
                .reduce((sum, s) => sum + s.timeMs, 0);

              return (
                <div
                  key={`${seg.segmentOrder}-${seg.label}`}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 ${bgColor}`}
                >
                  <span className={`text-xs font-bold w-5 ${iconColor}`}>
                    {i + 1}
                  </span>
                  <span className="text-xs font-medium flex-1 min-w-0 truncate">
                    {seg.label}
                    {isPB && (
                      <Star className="inline h-3 w-3 text-yellow-400 ml-1 -mt-0.5" />
                    )}
                  </span>
                  <span className="text-xs font-mono font-medium tabular-nums">
                    {formatMs(seg.timeMs)}
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground tabular-nums w-16 text-right">
                    {formatMsLong(cumulative)}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Save section */}
      {isLoggedIn && !saved && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Save className="h-3.5 w-3.5 text-muted-foreground" />
              Save Results
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <input
              type="text"
              placeholder="Race title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-sm placeholder:text-muted-foreground outline-none focus:border-primary/40"
            />
            <textarea
              placeholder="Notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2 text-sm placeholder:text-muted-foreground outline-none focus:border-primary/40 resize-none"
            />
            {/* Race type toggle */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Race type
              </span>
              <div className="flex gap-1 rounded-lg bg-white/[0.03] p-1">
                <button
                  type="button"
                  onClick={() => setRaceType("practice")}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
                    raceType === "practice"
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-white/[0.04]"
                  }`}
                >
                  Practice sim
                </button>
                <button
                  type="button"
                  onClick={() => setRaceType("actual")}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
                    raceType === "actual"
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "text-muted-foreground hover:bg-white/[0.04]"
                  }`}
                >
                  Actual race
                </button>
              </div>
              <span className="text-[10px] text-muted-foreground/80">
                {raceType === "actual"
                  ? "Counts toward your race total and finish-time PR."
                  : "Recorded for tracking, not added to lifetime race count."}
              </span>
            </div>
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="w-full gap-2"
            >
              <Save className="h-4 w-4" />
              {isSaving ? "Saving..." : "Save Race"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Save success */}
      {saved && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-center flex flex-col gap-2 items-center">
          <p className="text-sm font-medium text-emerald-400">
            Race saved! Your benchmarks have been updated.
          </p>
          {savedRaceId && (
            <a
              href={`/hyrox/race-tools/races/${savedRaceId}`}
              className="text-xs text-primary hover:underline"
            >
              View race details &amp; AI report →
            </a>
          )}
        </div>
      )}

      {/* Not logged in CTA */}
      {!isLoggedIn && (
        <div className="rounded-xl bg-primary/10 border border-primary/20 p-4 text-center">
          <p className="text-sm font-medium">Want to save your results?</p>
          <p className="text-xs text-muted-foreground mt-1">
            Create a free account to track your practice races and see your progress over time.
          </p>
          <a
            href="/signup"
            className="inline-block mt-3 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Get started free
          </a>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <Button variant="outline" className="flex-1 gap-2" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button className="flex-1 gap-2" onClick={onNewRace}>
          <RotateCcw className="h-4 w-4" />
          New Race
        </Button>
      </div>
    </div>
  );
}
