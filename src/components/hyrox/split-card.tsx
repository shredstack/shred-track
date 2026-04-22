"use client";

import { Activity, Dumbbell } from "lucide-react";
import {
  formatTime,
  formatStationPace,
  STATION_PACE_TYPE,
  DIVISIONS,
  type StationName,
  type DivisionKey,
} from "@/lib/hyrox-data";

// ---------------------------------------------------------------------------
// Split card — one card per segment in the calculated splits
// ---------------------------------------------------------------------------

interface SplitCardProps {
  segmentNumber: number;
  segmentType: "run" | "station";
  segmentName: string;
  targetSeconds: number;
  cumulativeSeconds: number;
  /** Was this station manually edited by the user? */
  isEdited?: boolean;
  /** Division key for looking up station specs (distance, reps) */
  divisionKey?: DivisionKey;
}

export function SplitCard({
  segmentNumber,
  segmentType,
  segmentName,
  targetSeconds,
  cumulativeSeconds,
  isEdited = false,
  divisionKey,
}: SplitCardProps) {
  const isRun = segmentType === "run";
  const bgColor = isRun ? "bg-blue-500/[0.06]" : "bg-orange-500/[0.06]";
  const borderColor = isRun ? "border-blue-500/15" : "border-orange-500/15";
  const accentColor = isRun ? "text-blue-400" : "text-orange-400";
  const iconBg = isRun ? "bg-blue-500/15" : "bg-orange-500/15";

  // Compute meaningful pace
  let paceDisplay: string | null = null;
  if (isRun) {
    // Run pace per km
    const m = Math.floor(targetSeconds / 60);
    const s = Math.round(targetSeconds % 60);
    paceDisplay = `${m}:${s.toString().padStart(2, "0")}/km`;
  } else if (divisionKey) {
    // Station pace based on type
    const div = DIVISIONS[divisionKey];
    const stationSpec = div?.stations.find((st) => st.name === segmentName);
    const distanceM = stationSpec?.distance
      ? parseInt(stationSpec.distance.replace(/[^\d]/g, ""), 10)
      : undefined;
    paceDisplay = formatStationPace(
      segmentName,
      targetSeconds,
      distanceM,
      stationSpec?.reps,
    );
  }

  return (
    <div className={`flex items-center gap-3 rounded-xl ${bgColor} border ${borderColor} px-3 py-2.5`}>
      {/* Segment number + icon */}
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
        {isRun ? (
          <Activity className={`h-3.5 w-3.5 ${accentColor}`} />
        ) : (
          <span className={`text-xs font-bold ${accentColor}`}>{segmentNumber}</span>
        )}
      </div>

      {/* Name + pace */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-xs font-semibold truncate">
            {segmentName}
          </span>
          {isEdited && (
            <span className="text-[9px] text-orange-400 font-medium">*</span>
          )}
        </div>
        {paceDisplay && (
          <span className="text-[10px] text-muted-foreground">{paceDisplay}</span>
        )}
      </div>

      {/* Time + cumulative */}
      <div className="text-right shrink-0">
        <span className="text-sm font-mono font-semibold tabular-nums block">
          {formatTime(targetSeconds)}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
          {formatTime(cumulativeSeconds)}
        </span>
      </div>
    </div>
  );
}
