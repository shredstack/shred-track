"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Trophy, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatTime,
  getStandardStationBaseline,
  STATION_ORDER,
} from "@/lib/hyrox-data";
import { StationSparkline } from "./station-sparkline";
import {
  useHyroxStationBenchmarks,
  type HyroxStationBenchmark,
} from "@/hooks/useHyroxStationBenchmarks";

/**
 * Whether a benchmark row is eligible to be displayed as a "best time"
 * here. Distance and reps come back NULL on legacy rows — those are
 * treated as canonical (preserves the pre-feature behavior). Custom
 * races store the actual values; we filter those out when they fall
 * below ~90% of the standard adult baseline so a short sprint can't
 * displace a full-distance PR. Weight is not filtered at read time —
 * the time itself implicitly captures heavier scaling (slower).
 */
function isStandardAttempt(b: HyroxStationBenchmark): boolean {
  const baseline = getStandardStationBaseline(b.station);
  if (!baseline) return true;
  if (
    b.distanceMeters != null &&
    baseline.distanceM != null &&
    b.distanceMeters < baseline.distanceM * 0.9
  ) {
    return false;
  }
  if (
    b.reps != null &&
    baseline.reps != null &&
    b.reps < baseline.reps * 0.9
  ) {
    return false;
  }
  return true;
}

interface RowData {
  station: string;
  best: HyroxStationBenchmark;
  recent: HyroxStationBenchmark[]; // last 6 entries asc
  fromRace: boolean;
}

export function StationBestTimes() {
  const { data: rows, isLoading } = useHyroxStationBenchmarks();

  const grouped = useMemo<RowData[]>(() => {
    if (!rows || rows.length === 0) return [];
    const byStation = new Map<string, HyroxStationBenchmark[]>();
    for (const row of rows) {
      const arr = byStation.get(row.station) ?? [];
      arr.push(row);
      byStation.set(row.station, arr);
    }
    const result: RowData[] = [];
    for (const [station, entries] of byStation.entries()) {
      // Canonical-only sources for the "Best" pick and the sparkline.
      // If the user has no canonical attempts yet (all their logged
      // benchmarks are short sprints), fall back to all entries — this
      // keeps something on screen instead of dropping the station row.
      const canonical = entries.filter(isStandardAttempt);
      const pool = canonical.length > 0 ? canonical : entries;
      const sorted = [...pool].sort(
        (a, b) =>
          new Date(a.loggedAt).getTime() - new Date(b.loggedAt).getTime(),
      );
      const best = pool.reduce((m, e) =>
        e.timeSeconds < m.timeSeconds ? e : m,
      );
      result.push({
        station,
        best,
        recent: sorted.slice(-6),
        fromRace: !!best.sourceRaceId,
      });
    }
    // Sort by canonical station order, then alphabetical fallback
    const orderIndex = (name: string) => {
      const idx = (STATION_ORDER as readonly string[]).indexOf(name);
      return idx === -1 ? 999 : idx;
    };
    result.sort((a, b) => {
      const ai = orderIndex(a.station);
      const bi = orderIndex(b.station);
      if (ai !== bi) return ai - bi;
      return a.station.localeCompare(b.station);
    });
    return result;
  }, [rows]);

  if (isLoading) {
    return (
      <div className="h-32 rounded-xl bg-white/[0.04] animate-pulse" />
    );
  }

  if (grouped.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <Trophy className="h-3.5 w-3.5 text-primary" />
          Station Best Times
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-1">
          {grouped.map((row) => (
            <div
              key={row.station}
              className="flex items-center gap-3 py-1.5 border-b border-white/[0.04] last:border-0"
            >
              <span className="text-xs font-medium flex-1 min-w-0 truncate">
                {row.station}
              </span>
              <StationSparkline
                points={row.recent.map((p) => ({
                  loggedAt: p.loggedAt,
                  timeSeconds: p.timeSeconds,
                }))}
              />
              <span className="text-sm font-mono font-semibold tabular-nums w-12 text-right">
                {formatTime(row.best.timeSeconds)}
              </span>
              {row.best.sourceRaceId ? (
                <Link
                  href={`/hyrox/race-tools/races/${row.best.sourceRaceId}`}
                  className="flex items-center gap-0.5 rounded-md border border-primary/30 bg-primary/[0.06] px-1.5 py-0.5 text-[9px] font-medium text-primary"
                  title="From a saved race"
                >
                  <ExternalLink className="h-2.5 w-2.5" />
                  Race
                </Link>
              ) : (
                <span className="w-12 text-right text-[9px] text-muted-foreground/60 italic">
                  {row.best.source ?? "—"}
                </span>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
