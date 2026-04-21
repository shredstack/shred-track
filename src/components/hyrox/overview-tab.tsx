"use client";

import React, { useState, useMemo } from "react";
import {
  Info,
  Activity,
  Users,
  User,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  DIVISIONS,
  DIVISION_CATEGORIES,
  DIVISION_REF_DATA,
  STATION_ORDER,
  formatTime,
  kgToLbs,
  type DivisionKey,
  type DivisionCategoryGroup,
  type RefDistribution,
  type StationName,
} from "@/lib/hyrox-data";

export function OverviewTab() {
  const [useMixed, setUseMixed] = useState(false);
  const [activeDivision, setActiveDivision] = useState<DivisionKey>("women_open");
  const [expandedCategory, setExpandedCategory] = useState<string>("Singles");

  const division = DIVISIONS[activeDivision];
  const refData = DIVISION_REF_DATA[activeDivision];
  const hasRefs = !!refData;

  const convertWeight = (kg: number): string => {
    if (useMixed) return `${kgToLbs(kg)} lbs`;
    return `${kg} kg`;
  };

  const convertDistance = (distStr: string): string => {
    return distStr;
  };

  // Build the race flow based on the division's run structure
  const raceFlow = useMemo(() => {
    const d = DIVISIONS[activeDivision];
    const stationNames = d.stations.map((s) => s.name);

    if (d.runSegments === 8) {
      // Standard format: alternating run + station
      return stationNames.map((name, i) => ({
        runLabel: `Run ${i + 1} — ${d.runDistanceM >= 1000 ? `${d.runDistanceM / 1000} km` : `${d.runDistanceM}m`}`,
        stationName: name,
        stationIndex: i + 1,
      }));
    }

    if (d.runSegments === 3) {
      // Youngstars 8-9, 10-11: Run → [4 stations] → Run → [3 stations] → Run → [Wall Balls]
      const distLabel = `${d.runDistanceM}m`;
      return [
        { runLabel: `Run 1 — ${distLabel}`, stations: stationNames.slice(0, 4) },
        { runLabel: `Run 2 — ${distLabel}`, stations: stationNames.slice(4, 7) },
        { runLabel: `Run 3 — ${distLabel}`, stations: stationNames.slice(7, 8) },
      ];
    }

    if (d.runSegments === 2) {
      // Youngstars 12-13: 2 laps each run → [7 stations] → 2 laps → [Wall Balls]
      const distLabel = `${d.runDistanceM}m (2 laps)`;
      return [
        { runLabel: `Run 1 — ${distLabel}`, stations: stationNames.slice(0, 7) },
        { runLabel: `Run 2 — ${distLabel}`, stations: stationNames.slice(7, 8) },
      ];
    }

    return [];
  }, [activeDivision]);

  const isGroupedFormat = division.runSegments < 8;

  // Determine where run rows should appear in the station details table
  const runPositions = useMemo(() => {
    const d = DIVISIONS[activeDivision];
    if (d.runSegments === 8) return [0, 1, 2, 3, 4, 5, 6, 7];
    if (d.runSegments === 3) return [0, 4, 7]; // Run → [4 stations] → Run → [3 stations] → Run → [1 station]
    if (d.runSegments === 2) return [0, 7];     // Run → [7 stations] → Run → [1 station]
    return [];
  }, [activeDivision]);

  return (
    <div className="flex flex-col gap-4">
      {/* Race format explainer */}
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
            8 x 1 km runs, each followed by a functional workout station.
          </p>
          <p>
            Total distance: 8 km running + 8 stations. The clock runs
            continuously from start to finish.
          </p>
        </CardContent>
      </Card>

      {/* Unit toggle */}
      <div className="flex items-center justify-between rounded-xl bg-white/[0.03] border border-white/[0.06] px-4 py-3">
        <Label className="text-sm">Show in mixed units (Lbs/M)</Label>
        <Switch
          checked={useMixed}
          onCheckedChange={(val) => setUseMixed(val as boolean)}
        />
      </div>

      {/* Category-based division selector */}
      <div className="flex flex-col gap-2">
        {DIVISION_CATEGORIES.map((cat) => (
          <CategorySelector
            key={cat.label}
            category={cat}
            activeDivision={activeDivision}
            isExpanded={expandedCategory === cat.label}
            onToggle={() =>
              setExpandedCategory((prev) =>
                prev === cat.label ? "" : cat.label
              )
            }
            onSelectDivision={(key) => {
              setActiveDivision(key);
              setExpandedCategory(cat.label);
            }}
          />
        ))}
      </div>

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

      {/* Race flow diagram */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold">Race Flow</CardTitle>
        </CardHeader>
        <CardContent>
          {!isGroupedFormat ? (
            // Standard 8-run alternating format
            <div className="space-y-0">
              {(raceFlow as { runLabel: string; stationName: string; stationIndex: number }[]).map(
                (segment, i) => (
                  <div key={i}>
                    <div className="flex items-center gap-2.5 py-1.5">
                      <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-500/10">
                        <Activity className="h-3 w-3 text-blue-400" />
                      </div>
                      <span className="text-xs text-blue-400 font-medium">
                        {segment.runLabel}
                      </span>
                    </div>
                    <div className="ml-3 h-3 border-l border-dashed border-white/[0.08]" />
                    <div className="flex items-center gap-2.5 py-1.5">
                      <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-orange-500/10">
                        <span className="text-[10px] font-bold text-orange-400">
                          {segment.stationIndex}
                        </span>
                      </div>
                      <span className="text-xs font-medium">{segment.stationName}</span>
                    </div>
                    {i < raceFlow.length - 1 && (
                      <div className="ml-3 h-3 border-l border-dashed border-white/[0.08]" />
                    )}
                  </div>
                )
              )}
            </div>
          ) : (
            // Grouped format for Youngstars 8-13
            <div className="space-y-0">
              {(raceFlow as { runLabel: string; stations: string[] }[]).map(
                (block, i) => (
                  <div key={i}>
                    <div className="flex items-center gap-2.5 py-1.5">
                      <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-500/10">
                        <Activity className="h-3 w-3 text-blue-400" />
                      </div>
                      <span className="text-xs text-blue-400 font-medium">
                        {block.runLabel}
                      </span>
                    </div>
                    {block.stations.map((station, j) => (
                      <div key={j}>
                        <div className="ml-3 h-3 border-l border-dashed border-white/[0.08]" />
                        <div className="flex items-center gap-2.5 py-1.5">
                          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-orange-500/10">
                            <span className="text-[10px] font-bold text-orange-400">
                              {/* Global station number */}
                              {(raceFlow as { runLabel: string; stations: string[] }[])
                                .slice(0, i)
                                .reduce((sum, b) => sum + b.stations.length, 0) + j + 1}
                            </span>
                          </div>
                          <span className="text-xs font-medium">{station}</span>
                        </div>
                      </div>
                    ))}
                    {i < raceFlow.length - 1 && (
                      <div className="ml-3 h-3 border-l border-dashed border-white/[0.08]" />
                    )}
                  </div>
                )
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Division table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-bold">{division.label} — Station Details</CardTitle>
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
                    const spec = s.distance
                      ? `${convertDistance(s.distance)}${s.weightLabel ? ` @ ${useMixed && s.weightKg ? convertWeight(s.weightKg) : s.weightLabel}` : ""}`
                      : `${s.reps} reps${s.weightLabel ? ` @ ${useMixed && s.weightKg ? convertWeight(s.weightKg) : s.weightLabel}` : ""}`;

                    return (
                      <React.Fragment key={s.name}>
                        {/* Run row — only shown at correct positions */}
                        {showRun && (
                          <tr className="border-b border-white/[0.04]">
                            <td className="py-2 pr-3 font-medium text-muted-foreground">{runLabel}</td>
                            <td className="py-2 pr-3 text-muted-foreground font-mono">{division.runDistanceM >= 1000 ? `${division.runDistanceM / 1000} km` : `${division.runDistanceM}m`}</td>
                            {hasRefs && <DistCells dist={runDist} range={runRange} />}
                          </tr>
                        )}
                        {/* Station row */}
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
                  {/* Roxzone total */}
                  {hasRefs && refData?.roxzone && (
                    <tr className="border-t border-white/[0.08]">
                      <td className="py-2.5 pr-3 font-medium text-muted-foreground">Roxzone</td>
                      <td className="py-2.5 pr-3 text-muted-foreground font-mono text-[10px]">total transitions</td>
                      <DistCells dist={refData.roxzone} range={refData.roxzoneRange} />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          {!hasRefs && (
            <p className="mt-3 text-xs text-muted-foreground italic">
              Reference times not yet available for this division — will be populated from scraped race data.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Percentile distribution cells — renders 5 <td> elements for [p10..p90]
// ---------------------------------------------------------------------------

function DistCells({ dist, range }: { dist?: RefDistribution; range?: [number, number] }) {
  const dash = <td className="py-2 pr-1 text-right font-mono text-muted-foreground">—</td>;
  if (!dist) {
    return <>{dash}{dash}{dash}{dash}{dash}{dash}{dash}</>;
  }
  return (
    <>
      <td className="py-2 pr-1 text-right font-mono text-emerald-400">{range ? formatTime(range[0]) : "—"}</td>
      <td className="py-2 pr-1 text-right font-mono text-emerald-400">{formatTime(dist[0])}</td>
      <td className="py-2 pr-1 text-right font-mono text-green-300">{formatTime(dist[1])}</td>
      <td className="py-2 pr-1 text-right font-mono text-yellow-300">{formatTime(dist[2])}</td>
      <td className="py-2 pr-1 text-right font-mono text-orange-300">{formatTime(dist[3])}</td>
      <td className="py-2 pr-1 text-right font-mono text-orange-400">{formatTime(dist[4])}</td>
      <td className="py-2 text-right font-mono text-red-400">{range ? formatTime(range[1]) : "—"}</td>
    </>
  );
}

// ---------------------------------------------------------------------------
// Category accordion selector
// ---------------------------------------------------------------------------

function CategorySelector({
  category,
  activeDivision,
  isExpanded,
  onToggle,
  onSelectDivision,
}: {
  category: DivisionCategoryGroup;
  activeDivision: DivisionKey;
  isExpanded: boolean;
  onToggle: () => void;
  onSelectDivision: (key: DivisionKey) => void;
}) {
  const hasActive = category.keys.includes(activeDivision);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <button
        onClick={onToggle}
        className={`w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors ${
          hasActive ? "bg-primary/5" : "hover:bg-white/[0.03]"
        }`}
      >
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold ${hasActive ? "text-primary" : ""}`}>
            {category.label}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {category.description}
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {isExpanded && (
        <div className="flex flex-wrap gap-1.5 px-3 pb-2.5">
          {category.keys.map((key) => {
            const div = DIVISIONS[key];
            // Shorten label for buttons (remove category prefix if obvious)
            const shortLabel = div.label
              .replace(/^(Women|Men|Girls|Boys|Mixed)\s+/, "$1 ")
              .replace(category.label + " ", "");

            return (
              <button
                key={key}
                onClick={() => onSelectDivision(key)}
                className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all duration-200 ${
                  activeDivision === key
                    ? "bg-primary/15 text-primary glow-primary-sm"
                    : "bg-white/[0.03] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                }`}
              >
                {shortLabel}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
