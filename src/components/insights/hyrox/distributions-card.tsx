"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";
import { useInsightsDistributions } from "@/hooks/useInsights";
import type { DivisionKey } from "@/lib/hyrox-data";
import { formatTime } from "@/lib/hyrox-data";
import type { SegmentAggregate } from "@/lib/insights/queries";

interface DistributionsCardProps {
  division: DivisionKey;
  eventId?: string;
}

export function DistributionsCard({ division, eventId }: DistributionsCardProps) {
  const { data, isLoading } = useInsightsDistributions(division, "station", eventId);
  const [expanded, setExpanded] = useState<string | null>(null);

  const stations = useMemo(() => {
    if (!data) return [];
    return data.sort((a, b) => a.segmentLabel.localeCompare(b.segmentLabel));
  }, [data]);

  if (isLoading) {
    return <DistributionsSkeleton />;
  }

  if (!stations.length) {
    return (
      <Card className="gradient-border">
        <CardContent className="flex flex-col items-center gap-3 py-10 bg-mesh rounded-xl">
          <p className="text-sm text-muted-foreground">No station data available yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="gradient-border overflow-visible">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center gap-2">
          <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
          Station Time Distributions
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Tap a station to see the full breakdown
        </p>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {stations.map((station) => (
          <BoxPlotRow
            key={station.segmentLabel}
            station={station}
            isExpanded={expanded === station.segmentLabel}
            onToggle={() =>
              setExpanded(
                expanded === station.segmentLabel ? null : station.segmentLabel,
              )
            }
          />
        ))}
      </CardContent>
    </Card>
  );
}

function BoxPlotRow({
  station,
  isExpanded,
  onToggle,
}: {
  station: SegmentAggregate;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  // Normalize to a visual range
  const min = station.p10;
  const max = station.p90;
  const range = max - min || 1;

  const pct = (val: number) => ((val - min) / range) * 100;

  return (
    <button
      onClick={onToggle}
      className="w-full text-left rounded-lg bg-white/[0.03] hover:bg-white/[0.06] transition-colors p-2.5"
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium">{station.segmentLabel}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          median {formatTime(Math.round(station.medianSeconds))}
        </span>
      </div>

      {/* Box plot visualization */}
      <div className="relative h-5 w-full">
        {/* Whisker line (p10 to p90) */}
        <div
          className="absolute top-1/2 h-px bg-white/20 -translate-y-1/2"
          style={{
            left: `${Math.max(0, pct(station.p10))}%`,
            width: `${Math.min(100, pct(station.p90) - pct(station.p10))}%`,
          }}
        />
        {/* Box (p25 to p75) */}
        <div
          className="absolute top-0.5 bottom-0.5 rounded-sm bg-primary/25 border border-primary/40"
          style={{
            left: `${Math.max(0, pct(station.p25))}%`,
            width: `${Math.min(100, pct(station.p75) - pct(station.p25))}%`,
          }}
        />
        {/* Median line */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-primary"
          style={{ left: `${pct(station.medianSeconds)}%` }}
        />
        {/* Whisker caps */}
        <div
          className="absolute top-1 bottom-1 w-px bg-white/30"
          style={{ left: `${pct(station.p10)}%` }}
        />
        <div
          className="absolute top-1 bottom-1 w-px bg-white/30"
          style={{ left: `${pct(station.p90)}%` }}
        />
      </div>

      {isExpanded && (
        <div className="mt-2 grid grid-cols-5 gap-2 text-center text-[10px] text-muted-foreground border-t border-white/[0.06] pt-2">
          <div>
            <div className="font-medium text-foreground">{formatTime(Math.round(station.p10))}</div>
            <div>p10</div>
          </div>
          <div>
            <div className="font-medium text-foreground">{formatTime(Math.round(station.p25))}</div>
            <div>p25</div>
          </div>
          <div>
            <div className="font-medium text-primary">{formatTime(Math.round(station.medianSeconds))}</div>
            <div>median</div>
          </div>
          <div>
            <div className="font-medium text-foreground">{formatTime(Math.round(station.p75))}</div>
            <div>p75</div>
          </div>
          <div>
            <div className="font-medium text-foreground">{formatTime(Math.round(station.p90))}</div>
            <div>p90</div>
          </div>
        </div>
      )}
    </button>
  );
}

function DistributionsSkeleton() {
  return (
    <Card className="gradient-border">
      <CardHeader className="pb-2">
        <div className="h-4 w-48 rounded bg-white/[0.04] animate-pulse" />
      </CardHeader>
      <CardContent className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-12 rounded bg-white/[0.04] animate-pulse" />
        ))}
      </CardContent>
    </Card>
  );
}
