"use client";

import { useState, useCallback } from "react";
import {
  Timer,
  Activity,
  Dumbbell,
  TrendingUp,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  useActivePlan,
  useProgressData,
  type RunProgress,
  type StationProgress,
  type WeeklyTotal,
} from "@/hooks/useHyroxPlan";
import { StationBestTimes } from "@/components/hyrox/race-history/station-best-times";
import { useHyroxStationBenchmarks } from "@/hooks/useHyroxStationBenchmarks";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPace(pace: string, unit: string | null): string {
  return `${pace} /${unit ?? "mi"}`;
}

function formatTimeShort(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <Card className="gradient-border overflow-visible">
      <CardContent className="flex flex-col items-center gap-4 py-14 bg-mesh rounded-xl">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500/10">
          <Timer className="h-6 w-6 text-orange-400" />
        </div>
        <div className="text-center">
          <p className="font-bold text-lg">No Progress Data Yet</p>
          <p className="mt-2 max-w-xs text-sm text-muted-foreground leading-relaxed">
            Start logging your training sessions to see your progress trends
            here — pace improvements, station times, and weekly volume.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Weekly overview table
// ---------------------------------------------------------------------------

function WeeklyOverview({ totals }: { totals: WeeklyTotal[] }) {
  const hasData = totals.some(
    (t) => t.sessionsCompleted > 0
  );
  if (!hasData) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
          Weekly Overview
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-xs min-w-[400px]">
            <thead>
              <tr className="border-b border-white/[0.06] text-muted-foreground">
                <th className="pb-2 pr-3 text-left font-medium">Week</th>
                <th className="pb-2 pr-3 text-right font-medium">Sessions</th>
                <th className="pb-2 pr-3 text-right font-medium">Distance</th>
                <th className="pb-2 text-right font-medium">Avg RPE</th>
              </tr>
            </thead>
            <tbody>
              {totals
                .filter((t) => t.sessionsCompleted > 0)
                .map((t) => (
                  <tr
                    key={t.week}
                    className="border-b border-white/[0.04] last:border-0"
                  >
                    <td className="py-2 pr-3 font-medium">Week {t.week}</td>
                    <td className="py-2 pr-3 text-right font-mono">
                      {t.sessionsCompleted}/{t.sessionsTotal}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">
                      {t.totalDistanceKm > 0
                        ? `${t.totalDistanceKm.toFixed(1)} km`
                        : "—"}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {t.avgRpe != null ? t.avgRpe.toFixed(1) : "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Run progress table
// ---------------------------------------------------------------------------

function RunProgressTable({ runs }: { runs: RunProgress[] }) {
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = useCallback(() => setExpanded((p) => !p), []);

  if (runs.length === 0) return null;

  const displayed = expanded ? runs : runs.slice(0, 5);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-blue-400" />
          Run Progress
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-xs min-w-[420px]">
            <thead>
              <tr className="border-b border-white/[0.06] text-muted-foreground">
                <th className="pb-2 pr-2 text-left font-medium">Wk</th>
                <th className="pb-2 pr-2 text-left font-medium">Session</th>
                <th className="pb-2 pr-2 text-right font-medium">Pace</th>
                <th className="pb-2 pr-2 text-right font-medium">Dist</th>
                <th className="pb-2 text-right font-medium">RPE</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((r, i) => {
                // Compare pace to target
                let paceColor = "";
                if (r.actualPace && r.targetPace) {
                  const actual = parsePace(r.actualPace);
                  const target = parsePace(
                    r.targetPace.replace(/\s*\/.*$/, "")
                  );
                  if (actual != null && target != null) {
                    const diff = (actual - target) / target;
                    if (diff <= 0) paceColor = "text-emerald-400";
                    else if (diff <= 0.1) paceColor = "text-amber-400";
                    else paceColor = "text-red-400";
                  }
                }

                return (
                  <tr
                    key={`${r.week}-${i}`}
                    className="border-b border-white/[0.04] last:border-0"
                  >
                    <td className="py-2 pr-2 text-muted-foreground">
                      {r.week}
                    </td>
                    <td className="py-2 pr-2 font-medium truncate max-w-[160px]">
                      {r.sessionTitle}
                    </td>
                    <td
                      className={`py-2 pr-2 text-right font-mono ${paceColor}`}
                    >
                      {r.actualPace
                        ? formatPace(r.actualPace, r.actualPaceUnit)
                        : "—"}
                    </td>
                    <td className="py-2 pr-2 text-right font-mono">
                      {r.actualDistanceValue && r.actualDistanceUnit
                        ? `${r.actualDistanceValue} ${r.actualDistanceUnit}`
                        : "—"}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {r.rpe ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {runs.length > 5 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleExpanded}
            className="w-full mt-2 text-xs gap-1 h-7"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3 w-3" /> Show less
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" /> Show all {runs.length} runs
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Station progress table
// ---------------------------------------------------------------------------

function StationProgressTable({
  stations,
}: {
  stations: StationProgress[];
}) {
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = useCallback(() => setExpanded((p) => !p), []);

  if (stations.length === 0) return null;

  const displayed = expanded ? stations : stations.slice(0, 5);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Dumbbell className="h-3.5 w-3.5 text-orange-400" />
          Station Progress
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-xs min-w-[380px]">
            <thead>
              <tr className="border-b border-white/[0.06] text-muted-foreground">
                <th className="pb-2 pr-2 text-left font-medium">Wk</th>
                <th className="pb-2 pr-2 text-left font-medium">Session</th>
                <th className="pb-2 pr-2 text-right font-medium">Time</th>
                <th className="pb-2 pr-2 text-right font-medium">Reps</th>
                <th className="pb-2 text-right font-medium">RPE</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((s, i) => (
                <tr
                  key={`${s.week}-${i}`}
                  className="border-b border-white/[0.04] last:border-0"
                >
                  <td className="py-2 pr-2 text-muted-foreground">{s.week}</td>
                  <td className="py-2 pr-2 font-medium truncate max-w-[160px]">
                    {s.sessionTitle}
                  </td>
                  <td className="py-2 pr-2 text-right font-mono">
                    {s.actualTimeSeconds != null
                      ? formatTimeShort(s.actualTimeSeconds)
                      : "—"}
                  </td>
                  <td className="py-2 pr-2 text-right font-mono">
                    {s.actualReps ?? "—"}
                  </td>
                  <td className="py-2 text-right font-mono">{s.rpe ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {stations.length > 5 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleExpanded}
            className="w-full mt-2 text-xs gap-1 h-7"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3 w-3" /> Show less
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" /> Show all{" "}
                {stations.length} entries
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Pace parser helper
// ---------------------------------------------------------------------------

function parsePace(pace: string): number | null {
  const parts = pace.split(":").map(Number);
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return parts[0] * 60 + parts[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function HyroxBenchmarksPage() {
  const { data: plan } = useActivePlan();
  const planId = plan?.generationStatus === "completed" ? plan.id : null;
  const { data: progress, isLoading } = useProgressData(planId);
  const { data: stationBenchmarks } = useHyroxStationBenchmarks();

  const hasStationBenchmarks = (stationBenchmarks?.length ?? 0) > 0;
  const planIsActive = plan && plan.generationStatus === "completed";

  // No active plan AND no station benchmark history → full empty state.
  if (!planIsActive && !hasStationBenchmarks) {
    return <EmptyState />;
  }

  if (isLoading && planIsActive && !stationBenchmarks) {
    return (
      <div className="flex flex-col gap-4 animate-pulse">
        <div className="h-28 rounded-xl bg-white/[0.04]" />
        <div className="h-48 rounded-xl bg-white/[0.04]" />
        <div className="h-48 rounded-xl bg-white/[0.04]" />
      </div>
    );
  }

  const hasPlanProgress =
    progress &&
    (progress.runs.length > 0 ||
      progress.stations.length > 0 ||
      progress.weeklyTotals.some((t) => t.sessionsCompleted > 0));

  return (
    <div className="flex flex-col gap-4">
      {/* Page header */}
      <div>
        <h2 className="text-lg font-bold">Benchmarks &amp; Progress</h2>
        <p className="text-xs text-muted-foreground">
          Station best times, race-day splits, and training-plan results.
        </p>
      </div>

      {/* Station best times — sourced from hyrox_station_benchmarks (includes practice races) */}
      <StationBestTimes />

      {planIsActive && hasPlanProgress && progress && (
        <>
          <WeeklyOverview totals={progress.weeklyTotals} />
          <RunProgressTable runs={progress.runs} />
          <StationProgressTable stations={progress.stations} />
        </>
      )}

      {!planIsActive && !hasStationBenchmarks && <EmptyState />}
    </div>
  );
}
