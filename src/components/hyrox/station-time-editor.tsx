"use client";

import { useState, useMemo, useCallback } from "react";
import { ChevronDown, RotateCcw, Dumbbell } from "lucide-react";
import { TimeInput } from "@/components/shared/time-input";
import { Button } from "@/components/ui/button";
import {
  STATION_ORDER,
  formatTime,
  parseTimeToSeconds,
  type StationName,
} from "@/lib/hyrox-data";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function secondsToMSS(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface StationTimeEditorProps {
  /** Proportional times from the calculator (auto-distributed) */
  proportionalTimes: Record<StationName, number>;
  /** User overrides — stations the user has manually edited */
  overrides: Record<string, string>;
  /** Called when user edits a station time */
  onOverrideChange: (station: string, value: string) => void;
  /** Called when user clicks reset */
  onReset: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StationTimeEditor({
  proportionalTimes,
  overrides,
  onOverrideChange,
  onReset,
}: StationTimeEditorProps) {
  const [expanded, setExpanded] = useState(false);

  const hasOverrides = Object.keys(overrides).length > 0;

  // Compute effective times (override or proportional)
  const effectiveTimes = useMemo(() => {
    return STATION_ORDER.map((station) => {
      const overrideStr = overrides[station];
      if (overrideStr) {
        const parsed = parseTimeToSeconds(overrideStr);
        return {
          station,
          seconds: isNaN(parsed) || parsed <= 0 ? proportionalTimes[station] : parsed,
          isOverride: true,
        };
      }
      return {
        station,
        seconds: proportionalTimes[station],
        isOverride: false,
      };
    });
  }, [proportionalTimes, overrides]);

  const totalStationSeconds = effectiveTimes.reduce((sum, t) => sum + t.seconds, 0);

  return (
    <div className="flex flex-col gap-1.5">
      {/* Toggle header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2.5 hover:bg-white/[0.05] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Dumbbell className="h-3.5 w-3.5 text-orange-400" />
          <span className="text-xs font-medium">
            Customize Station Times
          </span>
          {hasOverrides && (
            <span className="text-[10px] text-orange-400 font-medium">
              ({Object.keys(overrides).length} edited)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground">
            {formatTime(totalStationSeconds)}
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </div>
      </button>

      {/* Expanded editor */}
      {expanded && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="flex flex-col gap-2.5">
            {STATION_ORDER.map((station) => {
              const overrideStr = overrides[station];
              const proportionalStr = secondsToMSS(proportionalTimes[station]);
              const displayValue = overrideStr ?? proportionalStr;
              const isOverride = !!overrideStr;

              return (
                <div key={station} className="flex items-center gap-2">
                  <span
                    className={`text-xs w-28 truncate ${
                      isOverride ? "text-orange-400 font-medium" : "text-muted-foreground"
                    }`}
                  >
                    {station}
                  </span>
                  <div className="flex-1">
                    <TimeInput
                      mode="ms"
                      value={displayValue}
                      onChange={(val) => onOverrideChange(station, val)}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer: total + reset */}
          <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-white/[0.06]">
            <span className="text-xs text-muted-foreground">
              Total station time:{" "}
              <span className="font-mono font-medium text-foreground">
                {formatTime(totalStationSeconds)}
              </span>
            </span>
            {hasOverrides && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 text-muted-foreground"
                onClick={onReset}
              >
                <RotateCcw className="h-3 w-3" />
                Reset to auto
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
