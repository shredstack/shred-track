"use client";

import { useState, useMemo, useCallback } from "react";
import {
  Clock,
  Timer,
  TrendingUp,
  BarChart3,
  ChevronRight,
  Columns3,
  List,
  Lightbulb,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePlanScenarios } from "@/hooks/useHyroxPlan";
import { formatTime, formatLongTime } from "@/lib/hyrox-data";
import type { RaceScenario, ScenarioSplit } from "@/types/hyrox-plan";

// ---------------------------------------------------------------------------
// Skeleton loader
// ---------------------------------------------------------------------------

function ScenariosSkeleton() {
  return (
    <div className="flex flex-col gap-4 animate-pulse">
      {/* Tab skeleton */}
      <div className="flex gap-1.5">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex-1 h-10 rounded-lg bg-white/[0.04]"
          />
        ))}
      </div>
      {/* Summary skeleton */}
      <div className="h-28 rounded-xl bg-white/[0.04]" />
      {/* Table skeleton */}
      <div className="h-64 rounded-xl bg-white/[0.04]" />
      {/* Analysis skeleton */}
      <div className="h-32 rounded-xl bg-white/[0.04]" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function ScenariosEmpty() {
  return (
    <Card className="gradient-border">
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500/10 mb-4">
          <BarChart3 className="h-6 w-6 text-orange-400" />
        </div>
        <p className="text-sm font-medium mb-1">No race-day scenarios yet</p>
        <p className="text-xs text-muted-foreground max-w-[260px]">
          Scenarios will be generated as part of your training plan. Check back
          once your plan has been created.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Summary bar
// ---------------------------------------------------------------------------

interface SummaryBarProps {
  scenario: RaceScenario;
}

function SummaryBar({ scenario }: SummaryBarProps) {
  const bufferColor =
    scenario.bufferSeconds !== null && scenario.bufferSeconds >= 0
      ? "text-emerald-400"
      : "text-red-400";

  const bufferLabel =
    scenario.bufferSeconds !== null
      ? `${scenario.bufferSeconds >= 0 ? "+" : ""}${formatTime(Math.abs(scenario.bufferSeconds))} buffer`
      : null;

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center justify-between gap-3">
          {/* Finish time */}
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground mb-0.5">
              Estimated Finish
            </span>
            <span className="text-2xl font-bold font-mono tracking-tight">
              {formatLongTime(scenario.estimatedFinishSeconds)}
            </span>
          </div>

          {/* Buffer + strategy */}
          <div className="flex flex-col items-end gap-1">
            {bufferLabel && (
              <Badge
                variant="outline"
                className={`${bufferColor} border-current/20 text-xs font-mono`}
              >
                {bufferLabel}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {scenario.runStrategy}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Split table
// ---------------------------------------------------------------------------

interface SplitTableProps {
  splits: ScenarioSplit[];
}

function SplitTable({ splits }: SplitTableProps) {
  const { totalRunSeconds, totalStationSeconds, transitionSeconds } =
    useMemo(() => {
      let runSec = 0;
      let stationSec = 0;
      for (const s of splits) {
        if (s.segmentType === "run") runSec += s.targetSeconds;
        else stationSec += s.targetSeconds;
      }
      const lastCumulative =
        splits.length > 0 ? splits[splits.length - 1].cumulativeSeconds : 0;
      const totalSplit = runSec + stationSec;
      const transition = Math.max(0, lastCumulative - totalSplit);
      return {
        totalRunSeconds: runSec,
        totalStationSeconds: stationSec,
        transitionSeconds: transition,
      };
    }, [splits]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Timer className="h-3.5 w-3.5 text-muted-foreground" />
          Split Breakdown
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto -mx-4">
          <div className="px-4 w-fit min-w-full">
          <table className="w-full text-xs min-w-[520px]">
            <thead>
              <tr className="border-b border-white/[0.06] text-muted-foreground">
                <th className="pb-2.5 pr-2 text-left font-medium w-6">#</th>
                <th className="pb-2.5 pr-2 text-left font-medium">Segment</th>
                <th className="pb-2.5 pr-2 text-right font-medium">Target</th>
                <th className="pb-2.5 pr-2 text-right font-medium">Pace</th>
                <th className="pb-2.5 pr-2 text-left font-medium">Strategy</th>
                <th className="pb-2.5 text-right font-medium">Cumul.</th>
              </tr>
            </thead>
            <tbody>
              {splits.map((split) => {
                const isRun = split.segmentType === "run";
                const rowBg = isRun
                  ? "bg-blue-500/[0.06]"
                  : "bg-orange-500/[0.06]";
                const numColor = isRun ? "text-blue-400" : "text-orange-400";

                return (
                  <tr
                    key={split.segmentNumber}
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
                    <td className="py-2 pr-2 text-muted-foreground min-w-[140px]">
                      {split.strategy}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {formatTime(split.cumulativeSeconds)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* Totals row */}
            <tfoot>
              <tr className="border-t-2 border-white/[0.08] font-medium">
                <td colSpan={2} className="py-2.5 pr-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-blue-400">
                      Run: {formatTime(totalRunSeconds)}
                    </span>
                    <span className="text-orange-400">
                      Stations: {formatTime(totalStationSeconds)}
                    </span>
                    {transitionSeconds > 0 && (
                      <span className="text-muted-foreground">
                        Transitions: {formatTime(transitionSeconds)}
                      </span>
                    )}
                  </div>
                </td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Analysis section
// ---------------------------------------------------------------------------

interface AnalysisProps {
  analysis: string | null;
}

function AnalysisSection({ analysis }: AnalysisProps) {
  if (!analysis) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Lightbulb className="h-3.5 w-3.5 text-yellow-400" />
          Where to Find Time
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
          {analysis}
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Comparison view
// ---------------------------------------------------------------------------

interface ComparisonViewProps {
  scenarios: RaceScenario[];
}

function ComparisonView({ scenarios }: ComparisonViewProps) {
  const sorted = useMemo(
    () => [...scenarios].sort((a, b) => a.sortOrder - b.sortOrder),
    [scenarios]
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Columns3 className="h-3.5 w-3.5 text-muted-foreground" />
          Scenario Comparison
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto -mx-4">
          <div className="px-4 w-fit min-w-full">
            <table className="w-full text-xs min-w-[380px]">
              <thead>
                <tr className="border-b border-white/[0.06] text-muted-foreground">
                  <th className="pb-2.5 pr-3 text-left font-medium">Scenario</th>
                  <th className="pb-2.5 pr-3 text-right font-medium">Finish</th>
                  <th className="pb-2.5 pr-3 text-right font-medium">Buffer</th>
                  <th className="pb-2.5 text-left font-medium">Run Strategy</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((sc) => {
                  const bufferColor =
                    sc.bufferSeconds !== null && sc.bufferSeconds >= 0
                      ? "text-emerald-400"
                      : "text-red-400";

                  return (
                    <tr
                      key={sc.scenarioLabel}
                      className="border-b border-white/[0.04] last:border-0"
                    >
                      <td className="py-2.5 pr-3 font-medium">
                        {sc.scenarioLabel}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono font-bold">
                        {formatLongTime(sc.estimatedFinishSeconds)}
                      </td>
                      <td
                        className={`py-2.5 pr-3 text-right font-mono ${bufferColor}`}
                      >
                        {sc.bufferSeconds !== null
                          ? `${sc.bufferSeconds >= 0 ? "+" : ""}${formatTime(Math.abs(sc.bufferSeconds))}`
                          : "--"}
                      </td>
                      <td className="py-2.5 text-muted-foreground">
                        {sc.runStrategy}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface ScenariosTabProps {
  planId: string;
}

export function ScenariosTab({ planId }: ScenariosTabProps) {
  const { data, isLoading } = usePlanScenarios(planId);
  const [activeIndex, setActiveIndex] = useState(0);
  const [showComparison, setShowComparison] = useState(false);

  const scenarios: RaceScenario[] = useMemo(() => {
    if (!data || !Array.isArray(data)) return [];
    return [...(data as RaceScenario[])].sort(
      (a, b) => a.sortOrder - b.sortOrder
    );
  }, [data]);

  const activeScenario: RaceScenario | null = useMemo(
    () => scenarios[activeIndex] ?? null,
    [scenarios, activeIndex]
  );

  const handleTabClick = useCallback(
    (index: number) => {
      setActiveIndex(index);
      setShowComparison(false);
    },
    []
  );

  const toggleComparison = useCallback(() => {
    setShowComparison((prev) => !prev);
  }, []);

  // Loading
  if (isLoading) return <ScenariosSkeleton />;

  // Empty
  if (scenarios.length === 0) return <ScenariosEmpty />;

  return (
    <div className="flex flex-col gap-4">
      {/* Scenario selector tabs */}
      <div className="flex gap-1.5">
        {scenarios.map((sc, i) => (
          <button
            key={sc.scenarioLabel}
            onClick={() => handleTabClick(i)}
            className={`flex-1 rounded-lg px-2 py-2 text-xs font-medium transition-all duration-200 ${
              activeIndex === i && !showComparison
                ? "bg-primary/15 text-primary glow-primary-sm"
                : "bg-white/[0.03] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
            }`}
          >
            {sc.scenarioLabel}
          </button>
        ))}
      </div>

      {/* Comparison toggle */}
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleComparison}
          className="text-xs gap-1.5 h-8"
        >
          {showComparison ? (
            <>
              <List className="h-3.5 w-3.5" />
              Detail View
            </>
          ) : (
            <>
              <Columns3 className="h-3.5 w-3.5" />
              Compare All
            </>
          )}
        </Button>
      </div>

      {showComparison ? (
        <ComparisonView scenarios={scenarios} />
      ) : (
        activeScenario && (
          <>
            {/* Summary bar */}
            <SummaryBar scenario={activeScenario} />

            {/* Split table */}
            <SplitTable splits={activeScenario.splits} />

            {/* Analysis */}
            <AnalysisSection analysis={activeScenario.analysis} />
          </>
        )
      )}
    </div>
  );
}
