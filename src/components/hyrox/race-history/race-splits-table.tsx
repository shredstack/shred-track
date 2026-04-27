"use client";

import { useMemo } from "react";
import { Activity, Dumbbell } from "lucide-react";
import {
  formatTime,
  formatLongTime,
  formatStationPace,
  estimatePercentile,
  DIVISIONS,
  DIVISION_REF_DATA,
  type DivisionKey,
  type StationName,
} from "@/lib/hyrox-data";
import { PercentileChip } from "./percentile-chip";
import type { PracticeRaceSplit } from "@/hooks/usePracticeRaces";

interface Props {
  splits: PracticeRaceSplit[];
  divisionKey: string | null;
  showPercentiles?: boolean;
}

export function RaceSplitsTable({
  splits,
  divisionKey,
  showPercentiles = true,
}: Props) {
  const refData = useMemo(() => {
    if (!divisionKey) return null;
    return DIVISION_REF_DATA[divisionKey as DivisionKey] ?? null;
  }, [divisionKey]);

  const division = useMemo(() => {
    if (!divisionKey) return null;
    return DIVISIONS[divisionKey as DivisionKey] ?? null;
  }, [divisionKey]);

  const orderedWithCumulative = useMemo(() => {
    const sorted = [...splits].sort((a, b) => a.segmentOrder - b.segmentOrder);
    return sorted.reduce<
      Array<{ split: PracticeRaceSplit; seconds: number; cumulative: number }>
    >((acc, split) => {
      const seconds = parseFloat(split.timeSeconds);
      const prevCum = acc.length === 0 ? 0 : acc[acc.length - 1].cumulative;
      acc.push({ split, seconds, cumulative: prevCum + seconds });
      return acc;
    }, []);
  }, [splits]);

  return (
    <div className="flex flex-col gap-1.5">
      {orderedWithCumulative.map(({ split, seconds, cumulative }) => {
        const isRun = split.segmentType === "run";

        // Lookup reference distribution for percentile chip.
        let percentile: number | null = null;
        if (showPercentiles && refData) {
          if (isRun) {
            const dist = refData.runs[split.segmentLabel];
            if (dist) percentile = estimatePercentile(seconds, dist);
          } else {
            const dist = refData.stations[split.segmentLabel as StationName];
            if (dist) percentile = estimatePercentile(seconds, dist);
          }
        }

        // Pace string
        let paceDisplay: string | null = null;
        if (isRun) {
          // Run pace per km — fall back to per-segment-time if no division
          const distM = split.distanceMeters ?? division?.runDistanceM ?? 1000;
          const perKm = (seconds / distM) * 1000;
          const m = Math.floor(perKm / 60);
          const s = Math.round(perKm % 60);
          paceDisplay = `${m}:${s.toString().padStart(2, "0")}/km`;
        } else if (division) {
          const stationSpec = division.stations.find(
            (st) => st.name === split.segmentLabel,
          );
          const distanceM = stationSpec?.distance
            ? parseInt(stationSpec.distance.replace(/[^\d]/g, ""), 10)
            : (split.distanceMeters ?? undefined);
          paceDisplay = formatStationPace(
            split.segmentLabel,
            seconds,
            distanceM,
            stationSpec?.reps ?? split.reps ?? undefined,
          );
        }

        const bgColor = isRun ? "bg-blue-500/[0.06]" : "bg-orange-500/[0.06]";
        const borderColor = isRun ? "border-blue-500/15" : "border-orange-500/15";
        const accentColor = isRun ? "text-blue-400" : "text-orange-400";
        const iconBg = isRun ? "bg-blue-500/15" : "bg-orange-500/15";

        return (
          <div
            key={split.id}
            className={`flex items-center gap-3 rounded-xl ${bgColor} border ${borderColor} px-3 py-2.5`}
          >
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
              {isRun ? (
                <Activity className={`h-3.5 w-3.5 ${accentColor}`} />
              ) : (
                <Dumbbell className={`h-3.5 w-3.5 ${accentColor}`} />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-semibold truncate">
                  {split.segmentLabel}
                </span>
                {showPercentiles && percentile != null && (
                  <PercentileChip percentile={percentile} />
                )}
              </div>
              {paceDisplay && (
                <span className="text-[10px] text-muted-foreground">
                  {paceDisplay}
                </span>
              )}
            </div>

            <div className="text-right shrink-0">
              <span className="text-sm font-mono font-semibold tabular-nums block">
                {formatTime(Math.round(seconds))}
              </span>
              <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                {formatLongTime(Math.round(cumulative))}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
