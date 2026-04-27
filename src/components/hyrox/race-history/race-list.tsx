"use client";

import { useMemo } from "react";
import { Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { RaceListCard } from "./race-list-card";
import {
  usePracticeRaces,
  sortRacesNewestFirst,
  type PracticeRace,
} from "@/hooks/usePracticeRaces";

interface Props {
  /** When provided, show at most N races (e.g. embedded summary on /history). */
  limit?: number;
  /** Pre-loaded list (skips the network fetch). */
  initialRaces?: PracticeRace[];
}

export function RaceList({ limit, initialRaces }: Props) {
  const { data: races, isLoading } = usePracticeRaces();

  // Compute per-template ordered list to derive deltas vs previous same-template race.
  const enriched = useMemo(() => {
    const list = initialRaces ?? races ?? [];
    const sorted = sortRacesNewestFirst(list);
    const limited = limit ? sorted.slice(0, limit) : sorted;
    return limited.map((race) => {
      // Find the next-older race with the same template among ALL sorted races
      // (not just the limited slice) so deltas remain meaningful when truncated.
      const idx = sorted.findIndex((r) => r.id === race.id);
      let prev: PracticeRace | null = null;
      for (let i = idx + 1; i < sorted.length; i++) {
        if (sorted[i].template === race.template) {
          prev = sorted[i];
          break;
        }
      }
      const deltaSeconds = prev
        ? Math.round(
            parseFloat(race.totalTimeSeconds) -
              parseFloat(prev.totalTimeSeconds),
          )
        : null;
      return { race, deltaSeconds };
    });
  }, [initialRaces, races, limit]);

  if (isLoading && !initialRaces) {
    return (
      <div className="flex flex-col gap-2 animate-pulse">
        <div className="h-16 rounded-xl bg-white/[0.04]" />
        <div className="h-16 rounded-xl bg-white/[0.04]" />
        <div className="h-16 rounded-xl bg-white/[0.04]" />
      </div>
    );
  }

  if (enriched.length === 0) {
    return (
      <Card className="gradient-border overflow-visible">
        <CardContent className="flex flex-col items-center gap-3 py-12 bg-mesh rounded-xl">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
            <Trophy className="h-5 w-5 text-primary/60" />
          </div>
          <div className="text-center">
            <p className="font-bold">No saved races yet</p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground leading-relaxed">
              Finish a race in the Timer tab to see it here.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {enriched.map(({ race, deltaSeconds }) => (
        <RaceListCard key={race.id} race={race} deltaSeconds={deltaSeconds} />
      ))}
    </div>
  );
}
