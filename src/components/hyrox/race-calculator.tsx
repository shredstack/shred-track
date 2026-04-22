"use client";

import { useState, useMemo, useCallback } from "react";
import {
  Calculator,
  Timer,
  Footprints,
  ArrowRightLeft,
  Download,
  RotateCcw,
  ArrowUpDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { TimeInput } from "@/components/shared/time-input";
import { DivisionPicker } from "@/components/shared/division-picker";
import { UnitToggle } from "@/components/shared/unit-toggle";
import { StationTimeEditor } from "@/components/hyrox/station-time-editor";
import { SplitCard } from "@/components/hyrox/split-card";
import { useUnits } from "@/hooks/useUnits";
import { useHyroxProfile, usePlanScenarios } from "@/hooks/useHyroxPlan";
import {
  STATION_ORDER,
  DIVISIONS,
  REFERENCE_TIMES,
  RUN_REFERENCE,
  formatTime,
  formatLongTime,
  parseTimeToSeconds,
  parseLongTimeToSeconds,
  convertWeightLabel,
  type DivisionKey,
  type StationName,
} from "@/lib/hyrox-data";
import type { RaceScenario } from "@/types/hyrox-plan";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 8;
const NUM_TRANSITIONS = 16;
const DEFAULT_TRANSITION_SECONDS = 15;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStationProportions(division: DivisionKey): Record<StationName, number> {
  const refs = REFERENCE_TIMES[division];
  const proportions = {} as Record<StationName, number>;
  let total = 0;
  for (const station of STATION_ORDER) {
    const avgSeconds = refs?.[station]?.[1] ?? 300;
    proportions[station] = avgSeconds;
    total += avgSeconds;
  }
  for (const station of STATION_ORDER) {
    proportions[station] = proportions[station] / total;
  }
  return proportions;
}

function getDefaultRunPace(division: DivisionKey): number {
  return RUN_REFERENCE[division]?.[1] ?? 300;
}

function secondsToPace(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function secondsToHMS(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.round(totalSeconds % 60);
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Calc modes
// ---------------------------------------------------------------------------

type CalcMode = "finish_to_stations" | "stations_to_finish";

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface RaceCalculatorProps {
  planId?: string;
}

export function RaceCalculator({ planId }: RaceCalculatorProps) {
  const { data: profile } = useHyroxProfile();
  const { data: scenariosData } = usePlanScenarios(planId ?? null);
  const { isMixed } = useUnits();
  const hasPlan = !!planId;

  const profileDivision = (profile?.targetDivision as DivisionKey) ?? "women_open";
  const [selectedDivision, setSelectedDivision] = useState<DivisionKey>(profileDivision);
  const division = hasPlan ? profileDivision : selectedDivision;

  const stationProportions = useMemo(() => getStationProportions(division), [division]);
  const divSpec = DIVISIONS[division];

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const defaultFinishSeconds = profile?.goalFinishTimeSeconds ?? 3600;
  const defaultRunPace = getDefaultRunPace(division);

  const [calcMode, setCalcMode] = useState<CalcMode>("finish_to_stations");
  const [finishTimeStr, setFinishTimeStr] = useState(() => secondsToHMS(defaultFinishSeconds));
  const [runPaceStr, setRunPaceStr] = useState(() => secondsToPace(defaultRunPace));
  const [transitionSeconds, setTransitionSeconds] = useState(DEFAULT_TRANSITION_SECONDS);
  const [stationOverrides, setStationOverrides] = useState<Record<string, string>>({});

  // ---------------------------------------------------------------------------
  // Parsed values
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

  // ---------------------------------------------------------------------------
  // Station times
  // ---------------------------------------------------------------------------

  const proportionalStationTimes = useMemo(() => {
    const result = {} as Record<StationName, number>;

    if (calcMode === "finish_to_stations") {
      if (finishSeconds === null || totalRunSeconds === null) {
        for (const station of STATION_ORDER) {
          result[station] = REFERENCE_TIMES[division]?.[station]?.[1] ?? 300;
        }
        return result;
      }
      const available = finishSeconds - totalRunSeconds - totalTransitionSeconds;
      if (available <= 0) {
        for (const station of STATION_ORDER) result[station] = 0;
        return result;
      }
      for (const station of STATION_ORDER) {
        result[station] = Math.round(available * stationProportions[station]);
      }
    } else {
      for (const station of STATION_ORDER) {
        result[station] = REFERENCE_TIMES[division]?.[station]?.[1] ?? 300;
      }
    }
    return result;
  }, [calcMode, finishSeconds, totalRunSeconds, totalTransitionSeconds, division, stationProportions]);

  const effectiveStationTimes = useMemo(() => {
    return STATION_ORDER.map((station) => {
      const override = stationOverrides[station];
      if (override) {
        const parsed = parseTimeToSeconds(override);
        if (!isNaN(parsed) && parsed > 0) return { station, seconds: parsed };
      }
      return { station, seconds: proportionalStationTimes[station] };
    });
  }, [proportionalStationTimes, stationOverrides]);

  const totalStationSeconds = effectiveStationTimes.reduce((sum, t) => sum + t.seconds, 0);

  const derivedFinishSeconds =
    calcMode === "stations_to_finish" && totalRunSeconds !== null
      ? totalRunSeconds + totalStationSeconds + totalTransitionSeconds
      : null;

  const displayFinishSeconds =
    calcMode === "stations_to_finish" ? derivedFinishSeconds : finishSeconds;

  // ---------------------------------------------------------------------------
  // Build splits
  // ---------------------------------------------------------------------------

  const fullSplits = useMemo(() => {
    if (runPaceSeconds === null) return null;
    if (effectiveStationTimes.some((t) => t.seconds <= 0)) return null;

    const splits: {
      segmentNumber: number;
      segmentType: "run" | "station";
      segmentName: string;
      targetSeconds: number;
      cumulativeSeconds: number;
      isEdited: boolean;
    }[] = [];
    let cumulative = 0;
    for (let i = 0; i < NUM_RUNS; i++) {
      cumulative += runPaceSeconds + transitionSeconds;
      splits.push({
        segmentNumber: i + 1,
        segmentType: "run",
        segmentName: `Run ${i + 1} (1km)`,
        targetSeconds: runPaceSeconds,
        cumulativeSeconds: cumulative,
        isEdited: false,
      });
      const stationTime = effectiveStationTimes[i].seconds;
      cumulative += stationTime + transitionSeconds;
      splits.push({
        segmentNumber: i + 1,
        segmentType: "station",
        segmentName: STATION_ORDER[i],
        targetSeconds: stationTime,
        cumulativeSeconds: cumulative,
        isEdited: !!stationOverrides[STATION_ORDER[i]],
      });
    }
    return splits;
  }, [runPaceSeconds, effectiveStationTimes, transitionSeconds, stationOverrides]);

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  const isValid =
    displayFinishSeconds !== null &&
    displayFinishSeconds > 0 &&
    runPaceSeconds !== null &&
    fullSplits !== null;

  const isOverBudget =
    calcMode === "finish_to_stations" &&
    finishSeconds !== null &&
    totalRunSeconds !== null &&
    totalRunSeconds + totalTransitionSeconds >= finishSeconds;

  const goalBufferSeconds =
    displayFinishSeconds !== null && profile?.goalFinishTimeSeconds
      ? profile.goalFinishTimeSeconds - displayFinishSeconds
      : null;

  // ---------------------------------------------------------------------------
  // Scenarios
  // ---------------------------------------------------------------------------

  const scenarios: RaceScenario[] = useMemo(() => {
    if (!scenariosData || !Array.isArray(scenariosData)) return [];
    return [...(scenariosData as RaceScenario[])].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [scenariosData]);

  const loadFromScenario = useCallback((scenario: RaceScenario) => {
    setCalcMode("finish_to_stations");
    setStationOverrides({});
    setFinishTimeStr(secondsToHMS(scenario.estimatedFinishSeconds));
    const runSplits = scenario.splits.filter((sp) => sp.segmentType === "run");
    if (runSplits.length > 0) {
      const avg = Math.round(
        runSplits.reduce((sum, sp) => sum + sp.targetSeconds, 0) / runSplits.length,
      );
      setRunPaceStr(secondsToPace(avg));
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handleOverrideChange = useCallback((station: string, value: string) => {
    setStationOverrides((prev) => ({ ...prev, [station]: value }));
  }, []);

  const handleResetOverrides = useCallback(() => {
    setStationOverrides({});
  }, []);

  const reset = useCallback(() => {
    setFinishTimeStr(secondsToHMS(defaultFinishSeconds));
    setRunPaceStr(secondsToPace(defaultRunPace));
    setTransitionSeconds(DEFAULT_TRANSITION_SECONDS);
    setStationOverrides({});
    setCalcMode("finish_to_stations");
  }, [defaultFinishSeconds, defaultRunPace]);

  const toggleMode = useCallback(() => {
    setCalcMode((prev) =>
      prev === "finish_to_stations" ? "stations_to_finish" : "finish_to_stations",
    );
    setStationOverrides({});
  }, []);

  // Station weight specs for display
  const stationWeightSpecs = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of divSpec.stations) {
      if (s.weightLabel) {
        map[s.name] = convertWeightLabel(s.weightLabel, s.weightKg, isMixed);
      }
    }
    return map;
  }, [divSpec, isMixed]);

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
            <div className="flex-1">
              <p className="text-sm font-bold">Race Calculator</p>
              <p className="text-xs text-muted-foreground">
                {calcMode === "finish_to_stations"
                  ? "Set your finish time — station times distribute automatically"
                  : "Set your station times — finish time calculates automatically"}
              </p>
            </div>
            <UnitToggle />
          </div>
        </CardContent>
      </Card>

      {/* Division selector (when no plan) */}
      {!hasPlan && (
        <DivisionPicker
          value={selectedDivision}
          onChange={setSelectedDivision}
          label="Division"
        />
      )}

      {/* Load from scenario (when plan exists) */}
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

      {/* Mode toggle */}
      <button
        onClick={toggleMode}
        className="flex items-center justify-center gap-2 rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2.5 text-xs font-medium text-muted-foreground hover:bg-white/[0.05] hover:text-foreground transition-colors"
      >
        <ArrowUpDown className="h-3.5 w-3.5" />
        {calcMode === "finish_to_stations"
          ? "Switch to: Set station times → calculate finish"
          : "Switch to: Set finish time → calculate stations"}
      </button>

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
              {calcMode === "finish_to_stations" ? "Target Finish Time" : "Calculated Finish Time"}
            </label>
            {calcMode === "finish_to_stations" ? (
              <>
                <TimeInput mode="hms" value={finishTimeStr} onChange={setFinishTimeStr} />
                {finishSeconds !== null && (
                  <span className="text-[11px] text-muted-foreground">
                    {formatLongTime(finishSeconds)}
                  </span>
                )}
              </>
            ) : (
              <div className="text-2xl font-bold font-mono tracking-tight">
                {derivedFinishSeconds !== null
                  ? formatLongTime(derivedFinishSeconds)
                  : "--:--:--"}
              </div>
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

          {/* Station time overrides */}
          <StationTimeEditor
            proportionalTimes={proportionalStationTimes}
            overrides={stationOverrides}
            onOverrideChange={handleOverrideChange}
            onReset={handleResetOverrides}
          />
        </CardContent>
      </Card>

      {/* Error state */}
      {isOverBudget && (
        <Card className="border-red-500/30">
          <CardContent className="py-4">
            <p className="text-sm text-red-400 font-medium">
              Running + transitions exceed your finish time. Increase finish time
              or speed up your run pace.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {isValid && fullSplits && displayFinishSeconds && (
        <>
          {/* Summary */}
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground mb-0.5">
                    {calcMode === "stations_to_finish"
                      ? "Projected Finish"
                      : "Target Finish"}
                  </span>
                  <span className="text-2xl font-bold font-mono tracking-tight">
                    {formatLongTime(displayFinishSeconds)}
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
                    width: `${((totalRunSeconds ?? 0) / displayFinishSeconds) * 100}%`,
                  }}
                />
                <div
                  className="bg-orange-500"
                  style={{
                    width: `${(totalStationSeconds / displayFinishSeconds) * 100}%`,
                  }}
                />
                <div
                  className="bg-white/10"
                  style={{
                    width: `${(totalTransitionSeconds / displayFinishSeconds) * 100}%`,
                  }}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
                <span className="text-blue-400">
                  Run {formatTime(totalRunSeconds ?? 0)}
                </span>
                <span className="text-orange-400">
                  Stations {formatTime(totalStationSeconds)}
                </span>
                <span>
                  Trans {formatTime(totalTransitionSeconds)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Splits — card-based layout */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Timer className="h-3.5 w-3.5 text-muted-foreground" />
                Race Splits
              </CardTitle>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Time · Cumulative
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-1.5">
                {fullSplits.map((split) => (
                  <SplitCard
                    key={`${split.segmentType}-${split.segmentNumber}`}
                    segmentNumber={split.segmentNumber}
                    segmentType={split.segmentType}
                    segmentName={split.segmentName}
                    targetSeconds={split.targetSeconds}
                    cumulativeSeconds={split.cumulativeSeconds}
                    isEdited={split.isEdited}
                    divisionKey={division}
                  />
                ))}
              </div>

              {/* Totals */}
              <div className="mt-3 pt-2.5 border-t border-white/[0.08] flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span className="text-blue-400 font-medium">
                  Running: {formatTime(totalRunSeconds ?? 0)}
                </span>
                <span className="text-orange-400 font-medium">
                  Stations: {formatTime(totalStationSeconds)}
                </span>
                <span className="text-muted-foreground">
                  Transitions: {formatTime(totalTransitionSeconds)}
                </span>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
