"use client";

import { formatTime, type RefDistribution } from "@/lib/hyrox-data";

interface ReferenceTimeBarProps {
  dist: RefDistribution;
  range?: [number, number];
}

/**
 * Mini horizontal bar showing where p50 sits between the fast and slow ends.
 * Displays key percentile labels below the bar.
 */
export function ReferenceTimeBar({ dist, range }: ReferenceTimeBarProps) {
  const [p10, p25, p50, p75, p90] = dist;
  const fast = range?.[0] ?? p10;
  const slow = range?.[1] ?? p90;
  const span = slow - fast;

  // Position p50 marker as percentage between fast and slow
  const p50Pct = span > 0 ? ((p50 - fast) / span) * 100 : 50;

  return (
    <div className="mt-2">
      {/* Bar */}
      <div className="relative h-2.5 w-full rounded-full overflow-hidden bg-gradient-to-r from-emerald-500/30 via-yellow-500/30 to-red-500/30">
        {/* p50 marker */}
        <div
          className="absolute top-0 h-full w-1 bg-white rounded-full shadow-sm shadow-white/50"
          style={{ left: `clamp(2%, ${p50Pct}%, 98%)` }}
        />
      </div>

      {/* Labels */}
      <div className="flex items-center justify-between mt-1 text-[10px] tabular-nums">
        <span className="text-emerald-400 font-mono">{formatTime(fast)}</span>
        <span className="text-muted-foreground">
          p50: <span className="text-yellow-300 font-mono">{formatTime(p50)}</span>
        </span>
        <span className="text-red-400 font-mono">{formatTime(slow)}</span>
      </div>
    </div>
  );
}
