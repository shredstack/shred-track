"use client";

import { useMemo } from "react";
import { Trophy, Calendar } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatTime, formatLongTime, DIVISIONS, type DivisionKey } from "@/lib/hyrox-data";
import { EditableTitle } from "./editable-title";
import type { PracticeRaceWithSplits } from "@/hooks/usePracticeRaces";

interface Props {
  race: PracticeRaceWithSplits;
  onTitleSave: (title: string) => Promise<void>;
}

export function RaceDetailHeader({ race, onTitleSave }: Props) {
  const total = parseFloat(race.totalTimeSeconds);
  const division =
    race.divisionKey && DIVISIONS[race.divisionKey as DivisionKey]
      ? DIVISIONS[race.divisionKey as DivisionKey].label
      : null;

  const { runTotal, stationTotal, slowest, fastest } = useMemo(() => {
    const runs = race.splits.filter((s) => s.segmentType === "run");
    const stations = race.splits.filter((s) => s.segmentType === "station");
    const sumRuns = runs.reduce((sum, s) => sum + parseFloat(s.timeSeconds), 0);
    const sumStations = stations.reduce(
      (sum, s) => sum + parseFloat(s.timeSeconds),
      0,
    );
    const sortedStations = [...stations].sort(
      (a, b) => parseFloat(b.timeSeconds) - parseFloat(a.timeSeconds),
    );
    return {
      runTotal: sumRuns,
      stationTotal: sumStations,
      slowest: sortedStations[0] ?? null,
      fastest: sortedStations[sortedStations.length - 1] ?? null,
    };
  }, [race.splits]);

  return (
    <Card className="gradient-border overflow-visible">
      <CardContent className="bg-mesh rounded-xl py-5 px-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/15">
            <Trophy className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <EditableTitle
              value={race.title || "Practice Race"}
              onSave={onTitleSave}
              className="text-lg w-full"
            />
            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span>
                {new Date(race.completedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
              {division && <span>· {division}</span>}
              {race.template !== "full" && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                  {race.template}
                </Badge>
              )}
              {race.raceType === "actual" && (
                <Badge
                  variant="outline"
                  className="text-[9px] px-1 py-0 h-4 border-emerald-500/40 text-emerald-400"
                >
                  Actual race
                </Badge>
              )}
            </div>
          </div>
        </div>

        <p className="text-3xl font-mono font-bold tracking-tight tabular-nums text-center mb-4">
          {formatLongTime(Math.round(total))}
        </p>

        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-lg bg-blue-500/[0.08] px-3 py-2">
            <p className="text-[10px] text-muted-foreground">Running total</p>
            <p className="text-sm font-mono font-semibold tabular-nums">
              {formatTime(Math.round(runTotal))}
            </p>
          </div>
          <div className="rounded-lg bg-orange-500/[0.08] px-3 py-2">
            <p className="text-[10px] text-muted-foreground">Stations total</p>
            <p className="text-sm font-mono font-semibold tabular-nums">
              {formatTime(Math.round(stationTotal))}
            </p>
          </div>
        </div>

        {slowest && fastest && slowest.id !== fastest.id && (
          <div className="flex items-center justify-between gap-2 mt-3 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[11px]">
            <div className="min-w-0 flex-1">
              <span className="text-muted-foreground">Slowest: </span>
              <span className="font-medium text-red-400 truncate">
                {slowest.segmentLabel}{" "}
                <span className="font-mono">
                  ({formatTime(Math.round(parseFloat(slowest.timeSeconds)))})
                </span>
              </span>
            </div>
            <div className="min-w-0 flex-1 text-right">
              <span className="text-muted-foreground">Fastest: </span>
              <span className="font-medium text-emerald-400 truncate">
                {fastest.segmentLabel}{" "}
                <span className="font-mono">
                  ({formatTime(Math.round(parseFloat(fastest.timeSeconds)))})
                </span>
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
