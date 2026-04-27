"use client";

import { useMemo } from "react";
import { Check, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTime, formatLongTime } from "@/lib/hyrox-data";
import {
  usePracticeRace,
  type PracticeRaceWithSplits,
} from "@/hooks/usePracticeRaces";

function formatDelta(deltaSec: number): string {
  const abs = Math.abs(deltaSec);
  const sign = deltaSec < 0 ? "−" : "+";
  if (abs < 1) return "0s";
  if (abs < 60) return `${sign}${Math.round(abs)}s`;
  const m = Math.floor(abs / 60);
  const s = Math.round(abs % 60);
  return `${sign}${m}:${s.toString().padStart(2, "0")}`;
}

interface Props {
  current: PracticeRaceWithSplits;
  compareToId: string;
}

export function RaceCompareView({ current, compareToId }: Props) {
  const { data: other, isLoading, error } = usePracticeRace(compareToId);

  const rows = useMemo(() => {
    if (!other) return [];
    const otherBySegment = new Map(
      other.splits.map((s) => [s.segmentOrder, s]),
    );
    return [...current.splits]
      .sort((a, b) => a.segmentOrder - b.segmentOrder)
      .map((curSplit) => {
        const prev = otherBySegment.get(curSplit.segmentOrder);
        if (!prev) return null;
        const cur = parseFloat(curSplit.timeSeconds);
        const old = parseFloat(prev.timeSeconds);
        const delta = cur - old;
        return {
          label: curSplit.segmentLabel,
          before: old,
          after: cur,
          delta,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }, [current.splits, other]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-xs text-muted-foreground">
          Loading comparison…
        </CardContent>
      </Card>
    );
  }

  if (error || !other) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-xs text-red-400">
          Couldn&apos;t load that race.
        </CardContent>
      </Card>
    );
  }

  const totalCurrent = parseFloat(current.totalTimeSeconds);
  const totalOther = parseFloat(other.totalTimeSeconds);
  const totalDelta = totalCurrent - totalOther;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold">
          vs {other.title || "Practice Race"}
        </CardTitle>
        <p className="text-[10px] text-muted-foreground">
          {new Date(other.completedAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-1">
          {rows.map((r) => {
            const faster = r.delta < 0;
            const tied = Math.abs(r.delta) < 0.5;
            return (
              <div
                key={r.label}
                className="flex items-center gap-2 text-[11px] py-1 border-b border-white/[0.04] last:border-0"
              >
                <span className="flex-1 min-w-0 truncate font-medium">
                  {r.label}
                </span>
                <span className="font-mono tabular-nums text-muted-foreground">
                  {formatTime(Math.round(r.before))}
                </span>
                <span className="text-muted-foreground">→</span>
                <span className="font-mono tabular-nums">
                  {formatTime(Math.round(r.after))}
                </span>
                <span
                  className={`font-mono tabular-nums w-12 text-right ${
                    tied
                      ? "text-muted-foreground"
                      : faster
                        ? "text-emerald-400"
                        : "text-red-400"
                  }`}
                >
                  {formatDelta(r.delta)}
                </span>
                {tied ? (
                  <span className="w-3" />
                ) : faster ? (
                  <Check className="h-3 w-3 text-emerald-400" />
                ) : (
                  <X className="h-3 w-3 text-red-400" />
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-3 pt-2 border-t border-white/[0.08] flex items-center gap-2 text-xs">
          <span className="flex-1 font-semibold">Total</span>
          <span className="font-mono tabular-nums text-muted-foreground">
            {formatLongTime(Math.round(totalOther))}
          </span>
          <span className="text-muted-foreground">→</span>
          <span className="font-mono tabular-nums font-bold">
            {formatLongTime(Math.round(totalCurrent))}
          </span>
          <span
            className={`font-mono tabular-nums w-12 text-right font-bold ${
              totalDelta < 0 ? "text-emerald-400" : totalDelta > 0 ? "text-red-400" : "text-muted-foreground"
            }`}
          >
            {formatDelta(totalDelta)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
