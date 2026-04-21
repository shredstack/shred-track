"use client";

import { useState, useMemo, useCallback } from "react";
import {
  Calculator,
  Timer,
  Footprints,
  ArrowRightLeft,
  Download,
  RotateCcw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { TimeInput } from "@/components/shared/time-input";
import { useHyroxProfile, usePlanScenarios } from "@/hooks/useHyroxPlan";
import {
  STATION_ORDER,
  REFERENCE_TIMES,
  RUN_REFERENCE,
  formatTime,
  formatLongTime,
  parseTimeToSeconds,
  parseLongTimeToSeconds,
  type DivisionKey,
  type StationName,
} from "@/lib/hyrox-data";
import type { RaceScenario } from "@/types/hyrox-plan";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 8;
const NUM_TRANSITIONS = 16; // transitions between each run/station pair
const DEFAULT_TRANSITION_SECONDS = 15; // per transition

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get average station reference times for a division */
function getStationProportions(division: DivisionKey): Record<StationName, number> {
  const refs = REFERENCE_TIMES[division];
  const proportions = {} as Record<StationName, number>;
  let total = 0;
  for (const station of STATION_ORDER) {
    const avgSeconds = refs?.[station]?.[1] ?? 300; // [pro, average, slow] → index 1
    proportions[station] = avgSeconds;
    total += avgSeconds;
  }
  // Normalize to ratios
  for (const station of STATION_ORDER) {
    proportions[station] = proportions[station] / total;
  }
  return proportions;
}

/** Get average run pace (seconds per km) for a division */
function getDefaultRunPace(division: DivisionKey): number {
  return RUN_REFERENCE[division]?.[1] ?? 300; // average tier
}

/** Format seconds as pace string M:SS */
function secondsToPace(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface RaceCalculatorProps {
  planId: string;
}

export function RaceCalculator({ planId }: RaceCalculatorProps) {
  const { data: profile } = useHyroxProfile();
  const { data: scenariosData } = usePlanScenarios(planId);

  const division: DivisionKey = (profile?.targetDivision as DivisionKey) ?? "women_open";
  const stationProportions = useMemo(() => getStationProportions(division), [division]);

  // ---------------------------------------------------------------------------
  // State — inputs
  // ---------------------------------------------------------------------------

  const defaultFinishSeconds = profile?.goalFinishTimeSeconds ?? 3600; // 1:00:00 fallback
  const defaultRunPace = getDefaultRunPace(division);

  const [finishTimeStr, setFinishTimeStr] = useState(() => {
    const h = Math.floor(defaultFinishSeconds / 3600);
    const m = Math.floor((defaultFinishSeconds % 3600) / 60);
    const s = defaultFinishSeconds % 60;
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  });

  const [runPaceStr, setRunPaceStr] = useState(() => secondsToPace(defaultRunPace));
  const [transitionSeconds, setTransitionSeconds] = useState(DEFAULT_TRANSITION_SECONDS);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const finishSeconds = useMemo(() => {
    const parsed = parseLongTimeToSeconds(finishTimeStr);
    return isNaN(parsed) || parsed <= 0 ? null : parsed;
  }, [finishTimeStr]);

  const runPaceSeconds = useMemo(() => {
    const parsed = parseTimeToSeconds(runPaceStr);
    return isNaN(parsed) || parsed <= 0 ? null : parsed;
  }, [runPaceStr]);

  const totalRunSeconds = runPaceSeconds !== null ? runPaceSeconds * NUM_RUNS : null;
  const totalTransitionSeconds = transitionSeconds * NUM_TRANSITIONS;

  const stationTimeAvailable = useMemo(() => {
    if (finishSeconds === null || totalRunSeconds === null) return null;
    const available = finishSeconds - totalRunSeconds - totalTransitionSeconds;
    return available > 0 ? available : null;
  }, [finishSeconds, totalRunSeconds, totalTransitionSeconds]);

  // Distribute station time proportionally
  const stationSplits = useMemo(() => {
    if (stationTimeAvailable === null) return null;
    return STATION_ORDER.map((station) => ({
      station,
      seconds: Math.round(stationTimeAvailable * stationProportions[station]),
    }));
  }, [stationTimeAvailable, stationProportions]);

  // Build the full split table (alternating run/station)
  const fullSplits = useMemo(() => {
    if (runPaceSeconds === null || stationSplits === null) return null;
    const splits: {
      segmentNumber: number;
      segmentType: "run" | "station";
      segmentName: string;
      targetSeconds: number;
      paceDisplay: string;
      cumulativeSeconds: number;
    }[] = [];
    let cumulative = 0;
    for (let i = 0; i < NUM_RUNS; i++) {
      // Run segment
      cumulative += runPaceSeconds + transitionSeconds; // transition before station
      splits.push({
        segmentNumber: i + 1,
        segmentType: "run",
        segmentName: `Run ${i + 1} (1km)`,
        targetSeconds: runPaceSeconds,
        paceDisplay: `${secondsToPace(runPaceSeconds)}/km`,
        cumulativeSeconds: cumulative,
      });
      // Station segment
      const stationTime = stationSplits[i].seconds;
      cumulative += stationTime + transitionSeconds; // transition after station
      splits.push({
        segmentNumber: i + 1,
        segmentType: "station",
        segmentName: STATION_ORDER[i],
        targetSeconds: stationTime,
        paceDisplay: formatTime(stationTime),
        cumulativeSeconds: cumulative,
      });
    }
    return splits;
  }, [runPaceSeconds, stationSplits, transitionSeconds]);

  // Summary stats
  const totalStationSeconds = stationSplits?.reduce((sum, s) => sum + s.seconds, 0) ?? 0;
  const goalBufferSeconds =
    finishSeconds !== null && profile?.goalFinishTimeSeconds
      ? profile.goalFinishTimeSeconds - finishSeconds
      : null;

  // ---------------------------------------------------------------------------
  // Load from scenario
  // ---------------------------------------------------------------------------

  const scenarios: RaceScenario[] = useMemo(() => {
    if (!scenariosData || !Array.isArray(scenariosData)) return [];
    return [...(scenariosData as RaceScenario[])].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [scenariosData]);

  const loadFromScenario = useCallback(
    (scenario: RaceScenario) => {
      // Set finish time
      const h = Math.floor(scenario.estimatedFinishSeconds / 3600);
      const m = Math.floor((scenario.estimatedFinishSeconds % 3600) / 60);
      const s = scenario.estimatedFinishSeconds % 60;
      setFinishTimeStr(`${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`);

      // Calculate average run pace from scenario splits
      const runSplits = scenario.splits.filter((sp) => sp.segmentType === "run");
      if (runSplits.length > 0) {
        const avgRunSeconds = Math.round(
          runSplits.reduce((sum, sp) => sum + sp.targetSeconds, 0) / runSplits.length,
        );
        setRunPaceStr(secondsToPace(avgRunSeconds));
      }
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------

  const reset = useCallback(() => {
    const h = Math.floor(defaultFinishSeconds / 3600);
    const m = Math.floor((defaultFinishSeconds % 3600) / 60);
    const s = defaultFinishSeconds % 60;
    setFinishTimeStr(`${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`);
    setRunPaceStr(secondsToPace(defaultRunPace));
    setTransitionSeconds(DEFAULT_TRANSITION_SECONDS);
  }, [defaultFinishSeconds, defaultRunPace]);

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  const isValid = finishSeconds !== null && runPaceSeconds !== null && stationTimeAvailable !== null;
  const isOverBudget =
    finishSeconds !== null &&
    totalRunSeconds !== null &&
    totalRunSeconds + totalTransitionSeconds >= finishSeconds;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10">
              <Calculator className="h-5 w-5 text-violet-400" />
            </div>
            <div>
              <p className="text-sm font-bold">Race Calculator</p>
              <p className="text-xs text-muted-foreground">
                Set your finish time and run pace — station times distribute automatically
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Load from scenario */}
      {scenarios.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Load from:</span>
          {scenarios.map((sc) => (
            <Button
              key={sc.scenarioLabel}
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => loadFromScenario(sc)}
            >
              <Download className="h-3 w-3" />
              {sc.scenarioLabel}
            </Button>
          ))}
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={reset}>
            <RotateCcw className="h-3 w-3" />
            Reset
          </Button>
        </div>
      )}

      {/* Inputs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold">Inputs</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {/* Target finish time */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Timer className="h-3.5 w-3.5" />
              Target Finish Time
            </label>
            <TimeInput mode="hms" value={finishTimeStr} onChange={setFinishTimeStr} />
            {finishSeconds !== null && (
              <span className="text-[11px] text-muted-foreground">
                {formatLongTime(finishSeconds)}
              </span>
            )}
          </div>

          {/* Run pace */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Footprints className="h-3.5 w-3.5" />
              Run Pace (per km)
            </label>
            <TimeInput mode="ms" value={runPaceStr} onChange={setRunPaceStr} />
            {totalRunSeconds !== null && (
              <span className="text-[11px] text-muted-foreground">
                8 x {runPaceStr}/km = {formatTime(totalRunSeconds)} total running
              </span>
            )}
          </div>

          {/* Transition buffer */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <ArrowRightLeft className="h-3.5 w-3.5" />
              Transition Time ({transitionSeconds}s each × {NUM_TRANSITIONS})
            </label>
            <Slider
              min={5}
              max={30}
              step={1}
              value={[transitionSeconds]}
              onValueChange={(v) => setTransitionSeconds(Array.isArray(v) ? v[0] : v)}
              className="w-full"
            />
            <span className="text-[11px] text-muted-foreground">
              {formatTime(totalTransitionSeconds)} total transition time
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Error state */}
      {isOverBudget && (
        <Card className="border-red-500/30">
          <CardContent className="py-4">
            <p className="text-sm text-red-400 font-medium">
              Running + transitions exceed your finish time. Increase finish time or speed up your
              run pace.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {isValid && fullSplits && (
        <>
          {/* Summary */}
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground mb-0.5">Calculated Finish</span>
                  <span className="text-2xl font-bold font-mono tracking-tight">
                    {formatLongTime(finishSeconds!)}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {goalBufferSeconds !== null && (
                    <Badge
                      variant="outline"
                      className={`${goalBufferSeconds >= 0 ? "text-emerald-400" : "text-red-400"} border-current/20 text-xs font-mono`}
                    >
                      {goalBufferSeconds >= 0 ? "+" : ""}
                      {formatTime(Math.abs(goalBufferSeconds))} vs goal
                    </Badge>
                  )}
                </div>
              </div>

              {/* Time distribution bar */}
              <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full">
                <div
                  className="bg-blue-500"
                  style={{
                    width: `${((totalRunSeconds ?? 0) / finishSeconds!) * 100}%`,
                  }}
                />
                <div
                  className="bg-orange-500"
                  style={{
                    width: `${(totalStationSeconds / finishSeconds!) * 100}%`,
                  }}
                />
                <div
                  className="bg-white/10"
                  style={{
                    width: `${(totalTransitionSeconds / finishSeconds!) * 100}%`,
                  }}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
                <span className="text-blue-400">
                  Run: {formatTime(totalRunSeconds ?? 0)} (
                  {Math.round(((totalRunSeconds ?? 0) / finishSeconds!) * 100)}%)
                </span>
                <span className="text-orange-400">
                  Stations: {formatTime(totalStationSeconds)} (
                  {Math.round((totalStationSeconds / finishSeconds!) * 100)}%)
                </span>
                <span>
                  Trans: {formatTime(totalTransitionSeconds)} (
                  {Math.round((totalTransitionSeconds / finishSeconds!) * 100)}%)
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Split table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Timer className="h-3.5 w-3.5 text-muted-foreground" />
                Calculated Splits
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto -mx-4">
                <div className="px-4 w-fit min-w-full">
                <table className="w-full text-xs min-w-[420px]">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-muted-foreground">
                      <th className="pb-2.5 pr-2 text-left font-medium w-6">#</th>
                      <th className="pb-2.5 pr-2 text-left font-medium">Segment</th>
                      <th className="pb-2.5 pr-2 text-right font-medium">Target</th>
                      <th className="pb-2.5 pr-2 text-right font-medium">Pace</th>
                      <th className="pb-2.5 text-right font-medium">Cumul.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fullSplits.map((split) => {
                      const isRun = split.segmentType === "run";
                      const rowBg = isRun ? "bg-blue-500/[0.06]" : "bg-orange-500/[0.06]";
                      const numColor = isRun ? "text-blue-400" : "text-orange-400";

                      return (
                        <tr
                          key={`${split.segmentType}-${split.segmentNumber}`}
                          className={`${rowBg} border-b border-white/[0.04] last:border-0`}
                        >
                          <td className={`py-2 pr-2 font-bold ${numColor}`}>
                            {split.segmentNumber}
                          </td>
                          <td className="py-2 pr-2 font-medium whitespace-nowrap">
                            {split.segmentName}
                          </td>
                          <td className="py-2 pr-2 text-right font-mono">
                            {formatTime(split.targetSeconds)}
                          </td>
                          <td className="py-2 pr-2 text-right font-mono text-muted-foreground">
                            {split.paceDisplay}
                          </td>
                          <td className="py-2 text-right font-mono">
                            {formatTime(split.cumulativeSeconds)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-white/[0.08] font-medium">
                      <td colSpan={2} className="py-2.5 pr-2">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-blue-400">
                            Run: {formatTime(totalRunSeconds ?? 0)}
                          </span>
                          <span className="text-orange-400">
                            Stations: {formatTime(totalStationSeconds)}
                          </span>
                          <span className="text-muted-foreground">
                            Transitions: {formatTime(totalTransitionSeconds)}
                          </span>
                        </div>
                      </td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                </table>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Station breakdown */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold">
                Station Time Distribution
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Based on average {division.includes("youngstars") ? (division.includes("women") ? "Girls" : "Boys") : division.includes("women") ? "Women" : "Men"} Open proportions
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2">
                {stationSplits!.map((split) => {
                  const pct = Math.round(split.seconds / totalStationSeconds * 100);
                  return (
                    <div key={split.station} className="flex items-center gap-3">
                      <span className="text-xs w-28 truncate">{split.station}</span>
                      <div className="flex-1 h-2 bg-white/[0.04] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-orange-500/60 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono w-12 text-right">
                        {formatTime(split.seconds)}
                      </span>
                      <span className="text-[10px] text-muted-foreground w-8 text-right">
                        {pct}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
