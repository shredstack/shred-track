"use client";

import { memo } from "react";

interface Props {
  /** Percentile 1–99 (lower = faster). Returns null-rendered when undefined. */
  percentile: number | null | undefined;
  className?: string;
}

function pickColor(p: number): string {
  // Lower percentile = faster.
  if (p <= 25) return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (p <= 50) return "bg-white/[0.04] text-muted-foreground border-white/[0.08]";
  if (p <= 75) return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  return "bg-red-500/15 text-red-300 border-red-500/30";
}

function PercentileChipImpl({ percentile, className = "" }: Props) {
  if (percentile == null) return null;
  const clamped = Math.max(1, Math.min(99, percentile));
  return (
    <span
      title={`Estimated percentile (lower = faster)`}
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-mono font-semibold tabular-nums ${pickColor(clamped)} ${className}`}
    >
      Top {clamped}%
    </span>
  );
}

export const PercentileChip = memo(PercentileChipImpl);
