"use client";

import { useMemo } from "react";
import { Activity, Dumbbell, ArrowRightLeft } from "lucide-react";
import {
  formatTime,
  formatLongTime,
  formatStationPace,
  estimatePercentile,
  parseDistanceToMeters,
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
        const isRoxzone = split.segmentSubtype === "roxzone";

        // Lookup reference distribution for percentile chip — but skip for
        // Roxzone segments (no reference distribution exists for 100m
        // transition runs and the prescribed-run distribution would be
        // a misleading comparison).
        let percentile: number | null = null;
        if (showPercentiles && refData && !isRoxzone) {
          if (isRun) {
            const dist = refData.runs[split.segmentLabel];
            if (dist) percentile = estimatePercentile(seconds, dist);
          } else {
            const dist = refData.stations[split.segmentLabel as StationName];
            if (dist) percentile = estimatePercentile(seconds, dist);
          }
        }

        // Pace string + modified-vs-canonical detection + the "what
        // did the athlete actually do" spec line (distance / reps / weight).
        let paceDisplay: string | null = null;
        let specDisplay: string | null = null;
        let modified = false;
        if (isRun) {
          // Roxzone is a fixed 100m segment; everyone else falls back to
          // the division's prescribed run distance.
          const distM = split.distanceMeters ?? (isRoxzone ? 100 : (division?.runDistanceM ?? 1000));
          const perKm = (seconds / distM) * 1000;
          const m = Math.floor(perKm / 60);
          const s = Math.round(perKm % 60);
          paceDisplay = `${m}:${s.toString().padStart(2, "0")}/km`;
          if (!isRoxzone && division && split.distanceMeters != null) {
            modified = split.distanceMeters !== division.runDistanceM;
          }
          specDisplay = distM >= 1000 && distM % 1000 === 0
            ? `${distM / 1000} km`
            : `${distM}m`;
        } else if (division) {
          const stationSpec = division.stations.find(
            (st) => st.name === split.segmentLabel,
          );
          // Prefer per-split (custom) values; fall back to canonical when null.
          const canonicalDistanceM = stationSpec?.distance
            ? parseDistanceToMeters(stationSpec.distance) ?? undefined
            : undefined;
          const distanceM = split.distanceMeters ?? canonicalDistanceM;
          const reps = split.reps ?? stationSpec?.reps ?? undefined;
          paceDisplay = formatStationPace(
            split.segmentLabel,
            seconds,
            distanceM,
            reps,
          );

          // Build the spec string from what was actually performed.
          // Prefer per-split numbers (custom) and fall back to the
          // station's canonical spec for legacy/full/half rows.
          const specParts: string[] = [];
          if (distanceM != null) specParts.push(`${distanceM}m`);
          if (reps != null) specParts.push(`${reps} reps`);
          const weightLabel =
            split.weightLabel ??
            (split.weightKg != null ? `${split.weightKg} kg` : null) ??
            stationSpec?.weightLabel ??
            null;
          if (weightLabel) specParts.push(`@ ${weightLabel}`);
          specDisplay = specParts.length > 0 ? specParts.join(" · ") : null;

          if (stationSpec) {
            if (
              split.distanceMeters != null &&
              canonicalDistanceM != null &&
              split.distanceMeters !== canonicalDistanceM
            ) {
              modified = true;
            }
            if (
              split.reps != null &&
              stationSpec.reps != null &&
              split.reps !== stationSpec.reps
            ) {
              modified = true;
            }
            if (
              split.weightKg != null &&
              stationSpec.weightKg != null &&
              Number(split.weightKg) !== stationSpec.weightKg
            ) {
              modified = true;
            }
          }
        }

        // Roxzone uses a third (muted teal) variant to disambiguate from
        // the headline 1km splits in the history view. Per spec §3.5.
        const bgColor = isRoxzone
          ? "bg-teal-500/[0.05]"
          : isRun
            ? "bg-blue-500/[0.06]"
            : "bg-orange-500/[0.06]";
        const borderColor = isRoxzone
          ? "border-teal-500/15"
          : isRun
            ? "border-blue-500/15"
            : "border-orange-500/15";
        const accentColor = isRoxzone
          ? "text-teal-400"
          : isRun
            ? "text-blue-400"
            : "text-orange-400";
        const iconBg = isRoxzone
          ? "bg-teal-500/15"
          : isRun
            ? "bg-blue-500/15"
            : "bg-orange-500/15";

        return (
          <div
            key={split.id}
            className={`flex items-center gap-3 rounded-xl ${bgColor} border ${borderColor} px-3 py-2.5`}
          >
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
              {isRoxzone ? (
                <ArrowRightLeft className={`h-3.5 w-3.5 ${accentColor}`} />
              ) : isRun ? (
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
                {isRoxzone && (
                  <span className="text-[9px] uppercase tracking-wider text-teal-400 font-medium">
                    Transition
                  </span>
                )}
                {modified && (
                  <span
                    className="text-[9px] uppercase tracking-wider rounded-sm border border-orange-400/30 bg-orange-400/[0.08] px-1 py-px text-orange-300"
                    title="Distance, reps, or weight differs from the division default"
                  >
                    modified
                  </span>
                )}
                {showPercentiles && percentile != null && !modified && (
                  <PercentileChip percentile={percentile} />
                )}
              </div>
              {(specDisplay || paceDisplay) && (
                <span className="text-[10px] text-muted-foreground">
                  {[specDisplay, paceDisplay].filter(Boolean).join(" · ")}
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
