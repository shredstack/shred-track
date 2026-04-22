"use client";

import { Activity } from "lucide-react";
import { ReferenceTimeBar } from "./reference-time-bar";
import { useUnits } from "@/hooks/useUnits";
import {
  convertWeightLabel,
  type StationSpec,
  type RefDistribution,
} from "@/lib/hyrox-data";

// ---------------------------------------------------------------------------
// Run card — blue connector between station cards
// ---------------------------------------------------------------------------

interface RunCardProps {
  runNumber: number;
  distance: string;
  dist?: RefDistribution;
  range?: [number, number];
}

export function RunCard({ runNumber, distance, dist, range }: RunCardProps) {
  return (
    <div className="flex flex-col">
      {runNumber > 1 && (
        <div className="mx-auto h-4 border-l border-dashed border-white/[0.08]" />
      )}
      <div className="rounded-xl bg-blue-500/[0.06] border border-blue-500/15 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/15">
            <Activity className="h-3.5 w-3.5 text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-xs font-semibold text-blue-400">
              Run {runNumber}
            </span>
            <span className="text-xs text-muted-foreground ml-2">{distance}</span>
          </div>
        </div>
        {dist && <ReferenceTimeBar dist={dist} range={range} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Station card — detailed view of a single station
// ---------------------------------------------------------------------------

interface StationCardProps {
  index: number;
  station: StationSpec;
  dist?: RefDistribution;
  range?: [number, number];
}

export function StationCard({
  index,
  station,
  dist,
  range,
}: StationCardProps) {
  const { isMixed } = useUnits();

  const weightDisplay = convertWeightLabel(
    station.weightLabel,
    station.weightKg,
    isMixed,
  );

  const weightLine = station.weightLabel
    ? isMixed
      ? `${station.weightLabel} / ${weightDisplay}`
      : station.weightLabel
    : null;

  return (
    <div className="flex flex-col">
      <div className="mx-auto h-4 border-l border-dashed border-white/[0.08]" />
      <div className="rounded-xl bg-orange-500/[0.06] border border-orange-500/15 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-500/15">
            <span className="text-xs font-bold text-orange-400">{index}</span>
          </div>
          <span className="text-sm font-semibold">{station.name}</span>
        </div>

        <div className="mt-2 flex flex-col gap-0.5 pl-[38px] text-xs text-muted-foreground">
          {station.distance && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground/60">Distance:</span>
              <span className="font-mono">{station.distance}</span>
            </div>
          )}
          {station.reps && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground/60">Reps:</span>
              <span className="font-mono">{station.reps}</span>
            </div>
          )}
          {weightLine && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground/60">Weight:</span>
              <span className="font-mono">{weightLine}</span>
            </div>
          )}
          {station.adaptation && (
            <div className="text-[10px] text-amber-400/80 mt-0.5">
              {station.adaptation}
            </div>
          )}
        </div>

        {dist && (
          <div className="pl-[38px]">
            <ReferenceTimeBar dist={dist} range={range} />
          </div>
        )}
      </div>
    </div>
  );
}
