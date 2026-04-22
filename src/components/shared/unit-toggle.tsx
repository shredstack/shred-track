"use client";

import { useUnits } from "@/hooks/useUnits";

interface UnitToggleProps {
  /** Optional extra CSS classes on the wrapper */
  className?: string;
}

/**
 * Compact toggle for switching between Metric (kg) and Mixed (lbs) units.
 * Reads and writes the global unit preference via useUnits().
 * Distances always stay in meters — only weights convert.
 */
export function UnitToggle({ className = "" }: UnitToggleProps) {
  const { mode, setMode } = useUnits();

  return (
    <div className={`flex rounded-lg bg-white/[0.04] p-0.5 gap-0.5 ${className}`}>
      <button
        onClick={() => setMode("metric")}
        className={`rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-all ${
          mode === "metric"
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Kg
      </button>
      <button
        onClick={() => setMode("mixed")}
        className={`rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-all ${
          mode === "mixed"
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Lbs
      </button>
    </div>
  );
}
