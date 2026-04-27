"use client";

import { memo } from "react";
import Link from "next/link";
import { Trophy, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DIVISIONS, type DivisionKey, formatLongTime } from "@/lib/hyrox-data";
import type { PracticeRace } from "@/hooks/usePracticeRaces";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDelta(deltaSeconds: number): string {
  const abs = Math.abs(deltaSeconds);
  const sign = deltaSeconds < 0 ? "−" : "+";
  const m = Math.floor(abs / 60);
  const s = Math.floor(abs % 60);
  if (m === 0) return `${sign}${s}s`;
  return `${sign}${m}:${s.toString().padStart(2, "0")}`;
}

interface Props {
  race: PracticeRace;
  /** Delta vs previous same-template race in seconds, or null if no prior */
  deltaSeconds: number | null;
}

function RaceListCardImpl({ race, deltaSeconds }: Props) {
  const total = parseFloat(race.totalTimeSeconds);
  const division =
    race.divisionKey && DIVISIONS[race.divisionKey as DivisionKey]
      ? DIVISIONS[race.divisionKey as DivisionKey].label
      : null;

  const deltaColor =
    deltaSeconds == null
      ? "text-muted-foreground"
      : deltaSeconds < 0
        ? "text-emerald-400"
        : deltaSeconds > 0
          ? "text-red-400"
          : "text-muted-foreground";

  return (
    <Link href={`/hyrox/race-tools/races/${race.id}`} className="block">
      <Card className="hover:border-primary/30 transition-colors">
        <CardContent className="py-3 px-4 flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15">
            <Trophy className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <p className="text-sm font-semibold truncate">
                {race.title || "Practice Race"}
              </p>
              {race.raceType === "actual" && (
                <Badge
                  variant="outline"
                  className="text-[9px] px-1 py-0 h-4 border-emerald-500/40 text-emerald-400"
                >
                  Race
                </Badge>
              )}
              {race.template !== "full" && (
                <Badge
                  variant="outline"
                  className="text-[9px] px-1 py-0 h-4"
                >
                  {race.template}
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {formatDate(race.completedAt)}
              {division && ` · ${division}`}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm font-mono font-bold tabular-nums">
                {formatLongTime(Math.round(total))}
              </span>
              {deltaSeconds != null && (
                <span className={`text-[10px] font-mono ${deltaColor}`}>
                  Δ {formatDelta(deltaSeconds)} vs prev
                </span>
              )}
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </CardContent>
      </Card>
    </Link>
  );
}

export const RaceListCard = memo(RaceListCardImpl);
