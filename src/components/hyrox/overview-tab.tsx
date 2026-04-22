"use client";

import React, { useState, useMemo } from "react";
import {
  Info,
  Activity,
  Users,
  User,
  LayoutGrid,
  Table,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DivisionPicker } from "@/components/shared/division-picker";
import { UnitToggle } from "@/components/shared/unit-toggle";
import { RunCard, StationCard } from "@/components/hyrox/station-card";
import { useUnits } from "@/hooks/useUnits";
import {
  DIVISIONS,
  DIVISION_REF_DATA,
  formatTime,
  convertWeightLabel,
  type DivisionKey,
  type RefDistribution,
  type StationName,
} from "@/lib/hyrox-data";

// ---------------------------------------------------------------------------
// Dynamic HYROX description based on division format
// ---------------------------------------------------------------------------

function getFormatDescription(divisionKey: DivisionKey): {
  headline: string;
  detail: string;
} {
  const d = DIVISIONS[divisionKey];

  if (divisionKey.includes("youngstars_8") || divisionKey.includes("youngstars_10")) {
    return {
      headline: `3 × ${d.runDistanceM}m runs with stations grouped between runs.`,
      detail: `Total: 3 runs + ${d.stations.length} stations. The clock runs continuously from start to finish.`,
    };
  }
  if (divisionKey.includes("youngstars_12")) {
    return {
      headline: `2 × ${d.runDistanceM}m runs (2 laps each) with stations grouped between runs.`,
      detail: `Total: 2 runs + ${d.stations.length} stations. The clock runs continuously from start to finish.`,
    };
  }
  if (divisionKey.includes("youngstars_14")) {
    return {
      headline: `8 × ${d.runDistanceM}m runs, each followed by a functional workout station.`,
      detail: `Total: ${(d.runDistanceM * 8) / 1000} km running + 8 stations. The clock runs continuously.`,
    };
  }
  if (d.category === "double" || d.category === "relay" || d.category === "corporate_relay") {
    const teamSize = d.athletes;
    return {
      headline: `8 × 1 km runs, each followed by a functional workout station.`,
      detail: `Same 8-station format — each leg is completed by ${teamSize} athletes as a team.`,
    };
  }

  // Standard singles / elite / adaptive
  return {
    headline: "8 × 1 km runs, each followed by a functional workout station.",
    detail: "Total distance: 8 km running + 8 stations. The clock runs continuously from start to finish.",
  };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type ViewMode = "cards" | "table";

export function OverviewTab() {
  const [activeDivision, setActiveDivision] = useState<DivisionKey>("women_open");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");

  const division = DIVISIONS[activeDivision];
  const refData = DIVISION_REF_DATA[activeDivision];
  const hasRefs = !!refData;
  const formatDesc = getFormatDescription(activeDivision);

  // Determine where run rows should appear in the station details
  const runPositions = useMemo(() => {
    const d = DIVISIONS[activeDivision];
    if (d.runSegments === 8) return [0, 1, 2, 3, 4, 5, 6, 7];
    if (d.runSegments === 3) return [0, 4, 7];
    if (d.runSegments === 2) return [0, 7];
    return [];
  }, [activeDivision]);

  return (
    <div className="flex flex-col gap-4">
      {/* Dynamic race format explainer */}
      <Card className="gradient-border overflow-visible">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-500/10">
              <Info className="h-3.5 w-3.5 text-blue-400" />
            </div>
            What is HYROX?
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5 text-sm text-muted-foreground leading-relaxed">
          <p>
            HYROX is a global fitness race combining running and functional
            workout stations. Every participant completes the same format:
          </p>
          <p className="font-semibold text-foreground">
            {formatDesc.headline}
          </p>
          <p>{formatDesc.detail}</p>
        </CardContent>
      </Card>

      {/* Controls row: unit toggle + view mode toggle */}
      <div className="flex items-center justify-between rounded-xl bg-white/[0.03] border border-white/[0.06] px-4 py-3">
        <UnitToggle />
        <div className="flex rounded-lg bg-white/[0.04] p-0.5 gap-0.5">
          <button
            onClick={() => setViewMode("cards")}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-all ${
              viewMode === "cards"
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LayoutGrid className="h-3 w-3" />
            Cards
          </button>
          <button
            onClick={() => setViewMode("table")}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-all ${
              viewMode === "table"
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Table className="h-3 w-3" />
            Table
          </button>
        </div>
      </div>

      {/* Division selector */}
      <DivisionPicker
        value={activeDivision}
        onChange={setActiveDivision}
        label="Select division"
      />

      {/* Division info banner */}
      <div className="flex items-center gap-3 rounded-xl bg-white/[0.03] border border-white/[0.06] px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
          {division.athletes > 1 ? (
            <Users className="h-4 w-4 text-primary" />
          ) : (
            <User className="h-4 w-4 text-primary" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{division.label}</p>
          <p className="text-xs text-muted-foreground truncate">
            {division.athletes} athlete{division.athletes > 1 ? "s" : ""} — {division.formatDescription}
          </p>
        </div>
      </div>

      {/* Station details — card view or table view */}
      {viewMode === "cards" ? (
        <CardView
          divisionKey={activeDivision}
          runPositions={runPositions}
        />
      ) : (
        <TableView
          divisionKey={activeDivision}
          runPositions={runPositions}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card view — one card per run/station, stacked vertically
// ---------------------------------------------------------------------------

function CardView({
  divisionKey,
  runPositions,
}: {
  divisionKey: DivisionKey;
  runPositions: number[];
}) {
  const division = DIVISIONS[divisionKey];
  const refData = DIVISION_REF_DATA[divisionKey];
  const runDist =
    division.runDistanceM >= 1000
      ? `${division.runDistanceM / 1000} km`
      : `${division.runDistanceM}m`;

  return (
    <div className="flex flex-col">
      {division.stations.map((station, i) => {
        const runIdx = runPositions.indexOf(i);
        const showRun = runIdx !== -1;
        const runLabel = showRun ? `Run ${runIdx + 1}` : null;
        const runDist_ = runLabel ? refData?.runs[runLabel] : undefined;
        const runRange = runLabel ? refData?.runRanges[runLabel] : undefined;
        const stationDist = refData?.stations[station.name as StationName];
        const stationRange = refData?.stationRanges[station.name as StationName];

        return (
          <React.Fragment key={station.name}>
            {showRun && (
              <RunCard
                runNumber={runIdx + 1}
                distance={runDist}
                dist={runDist_}
                range={runRange}
              />
            )}
            <StationCard
              index={i + 1}
              station={station}
              dist={stationDist}
              range={stationRange}
            />
          </React.Fragment>
        );
      })}

      {/* Roxzone */}
      {refData?.roxzone && (
        <>
          <div className="mx-auto h-4 border-l border-dashed border-white/[0.08]" />
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.06]">
                <Activity className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div>
                <span className="text-xs font-semibold text-muted-foreground">Roxzone</span>
                <span className="text-[10px] text-muted-foreground ml-2">total transitions</span>
              </div>
            </div>
            <div className="pl-[38px]">
              <div className="flex items-center justify-between mt-2 text-[10px] tabular-nums">
                <span className="text-emerald-400 font-mono">
                  {refData.roxzoneRange ? formatTime(refData.roxzoneRange[0]) : "—"}
                </span>
                <span className="text-muted-foreground">
                  p50: <span className="text-yellow-300 font-mono">{formatTime(refData.roxzone[2])}</span>
                </span>
                <span className="text-red-400 font-mono">
                  {refData.roxzoneRange ? formatTime(refData.roxzoneRange[1]) : "—"}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table view — compact horizontal table (existing layout, with weight fix)
// ---------------------------------------------------------------------------

function TableView({
  divisionKey,
  runPositions,
}: {
  divisionKey: DivisionKey;
  runPositions: number[];
}) {
  const { isMixed } = useUnits();
  const division = DIVISIONS[divisionKey];
  const refData = DIVISION_REF_DATA[divisionKey];
  const hasRefs = !!refData;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold">
          {division.label} — Station Details
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto -mx-4">
          <div className="px-4 w-fit min-w-full">
            <table className="w-full text-xs min-w-[340px]">
              <thead>
                <tr className="border-b border-white/[0.06] text-muted-foreground">
                  <th className="pb-2.5 pr-3 text-left font-medium">Segment</th>
                  <th className="pb-2.5 pr-3 text-left font-medium">Spec</th>
                  {hasRefs && (
                    <>
                      <th className="pb-2.5 pr-1 text-right font-medium text-emerald-400">Fast</th>
                      <th className="pb-2.5 pr-1 text-right font-medium text-emerald-400">p10</th>
                      <th className="pb-2.5 pr-1 text-right font-medium text-green-300">p25</th>
                      <th className="pb-2.5 pr-1 text-right font-medium text-yellow-300">p50</th>
                      <th className="pb-2.5 pr-1 text-right font-medium text-orange-300">p75</th>
                      <th className="pb-2.5 pr-1 text-right font-medium text-orange-400">p90</th>
                      <th className="pb-2.5 text-right font-medium text-red-400">Slow</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {division.stations.map((s, i) => {
                  const runIdx = runPositions.indexOf(i);
                  const showRun = runIdx !== -1;
                  const runLabel = showRun ? `Run ${runIdx + 1}` : null;
                  const runDist = runLabel ? refData?.runs[runLabel] : undefined;
                  const runRange = runLabel ? refData?.runRanges[runLabel] : undefined;
                  const stationDist = refData?.stations[s.name as StationName];
                  const stationRange = refData?.stationRanges[s.name as StationName];

                  const weightStr = convertWeightLabel(s.weightLabel, s.weightKg, isMixed);
                  const spec = s.distance
                    ? `${s.distance}${weightStr ? ` @ ${weightStr}` : ""}`
                    : `${s.reps} reps${weightStr ? ` @ ${weightStr}` : ""}`;

                  return (
                    <React.Fragment key={s.name}>
                      {showRun && (
                        <tr className="border-b border-white/[0.04]">
                          <td className="py-2 pr-3 font-medium text-muted-foreground">
                            {runLabel}
                          </td>
                          <td className="py-2 pr-3 text-muted-foreground font-mono">
                            {division.runDistanceM >= 1000
                              ? `${division.runDistanceM / 1000} km`
                              : `${division.runDistanceM}m`}
                          </td>
                          {hasRefs && <DistCells dist={runDist} range={runRange} />}
                        </tr>
                      )}
                      <tr className="border-b border-white/[0.04]">
                        <td className="py-2.5 pr-3 font-medium">
                          {s.shortName}
                          {s.adaptation && (
                            <span className="block text-[10px] text-muted-foreground font-normal mt-0.5">
                              {s.adaptation}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-muted-foreground font-mono">{spec}</td>
                        {hasRefs && <DistCells dist={stationDist} range={stationRange} />}
                      </tr>
                    </React.Fragment>
                  );
                })}
                {hasRefs && refData?.roxzone && (
                  <tr className="border-t border-white/[0.08]">
                    <td className="py-2.5 pr-3 font-medium text-muted-foreground">Roxzone</td>
                    <td className="py-2.5 pr-3 text-muted-foreground font-mono text-[10px]">
                      total transitions
                    </td>
                    <DistCells dist={refData.roxzone} range={refData.roxzoneRange} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        {!hasRefs && (
          <p className="mt-3 text-xs text-muted-foreground italic">
            Reference times not yet available for this division — will be
            populated from scraped race data.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Percentile distribution cells
// ---------------------------------------------------------------------------

function DistCells({
  dist,
  range,
}: {
  dist?: RefDistribution;
  range?: [number, number];
}) {
  const dash = (
    <td className="py-2 pr-1 text-right font-mono text-muted-foreground">—</td>
  );
  if (!dist) {
    return (
      <>
        {dash}
        {dash}
        {dash}
        {dash}
        {dash}
        {dash}
        {dash}
      </>
    );
  }
  return (
    <>
      <td className="py-2 pr-1 text-right font-mono text-emerald-400">
        {range ? formatTime(range[0]) : "—"}
      </td>
      <td className="py-2 pr-1 text-right font-mono text-emerald-400">
        {formatTime(dist[0])}
      </td>
      <td className="py-2 pr-1 text-right font-mono text-green-300">
        {formatTime(dist[1])}
      </td>
      <td className="py-2 pr-1 text-right font-mono text-yellow-300">
        {formatTime(dist[2])}
      </td>
      <td className="py-2 pr-1 text-right font-mono text-orange-300">
        {formatTime(dist[3])}
      </td>
      <td className="py-2 pr-1 text-right font-mono text-orange-400">
        {formatTime(dist[4])}
      </td>
      <td className="py-2 text-right font-mono text-red-400">
        {range ? formatTime(range[1]) : "—"}
      </td>
    </>
  );
}
