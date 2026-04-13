"use client";

import { useRef, useCallback } from "react";
import { cn } from "@/lib/utils";

interface TimeInputProps {
  /** "hms" = H:MM:SS, "ms" = M:SS */
  mode: "hms" | "ms";
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * Segmented time input with auto-advance between fields.
 * Renders [H] : [MM] : [SS] or [M] : [SS] depending on mode.
 */
export function TimeInput({ mode, value, onChange, className }: TimeInputProps) {
  const segments = parseValue(mode, value);
  const segmentCount = mode === "hms" ? 3 : 2;
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const setRef = useCallback(
    (index: number) => (el: HTMLInputElement | null) => {
      refs.current[index] = el;
    },
    [],
  );

  const handleChange = useCallback(
    (index: number, raw: string) => {
      // Only allow digits
      const digits = raw.replace(/\D/g, "");
      const maxVal = index === 0 ? (mode === "hms" ? 23 : 59) : 59;
      const maxLen = 2;

      // Clamp to max value
      let val = digits.slice(0, maxLen);
      if (val.length > 0 && parseInt(val, 10) > maxVal) {
        val = String(maxVal);
      }

      const next = [...segments];
      next[index] = val;
      onChange(formatSegments(mode, next));

      // Auto-advance when 2 digits entered
      if (val.length >= maxLen && index < segmentCount - 1) {
        refs.current[index + 1]?.focus();
        refs.current[index + 1]?.select();
      }
    },
    [segments, mode, segmentCount, onChange],
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      // Backspace on empty → move to previous segment
      if (e.key === "Backspace" && segments[index] === "" && index > 0) {
        e.preventDefault();
        refs.current[index - 1]?.focus();
        refs.current[index - 1]?.select();
      }
      // Arrow keys to navigate
      if (e.key === "ArrowLeft" && index > 0) {
        const input = e.currentTarget;
        if (input.selectionStart === 0) {
          e.preventDefault();
          refs.current[index - 1]?.focus();
          refs.current[index - 1]?.select();
        }
      }
      if (e.key === "ArrowRight" && index < segmentCount - 1) {
        const input = e.currentTarget;
        if (input.selectionStart === input.value.length) {
          e.preventDefault();
          refs.current[index + 1]?.focus();
          refs.current[index + 1]?.select();
        }
      }
    },
    [segments, segmentCount],
  );

  const labels = mode === "hms" ? ["H", "MM", "SS"] : ["M", "SS"];
  const placeholders = mode === "hms" ? ["0", "00", "00"] : ["0", "00"];

  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      {Array.from({ length: segmentCount }).map((_, i) => (
        <div key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-sm font-mono text-muted-foreground select-none">:</span>}
          <div className="flex flex-col items-center">
            <input
              ref={setRef(i)}
              type="text"
              inputMode="numeric"
              value={segments[i]}
              placeholder={placeholders[i]}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              onFocus={(e) => e.target.select()}
              className={cn(
                "w-10 rounded-md border border-input bg-background px-1 py-1.5 text-center font-mono text-sm",
                "ring-offset-background placeholder:text-muted-foreground/50",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              )}
              maxLength={2}
            />
            <span className="mt-0.5 text-[10px] text-muted-foreground/60 select-none">{labels[i]}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Parse a time string into segment array */
function parseValue(mode: "hms" | "ms", value: string): string[] {
  const parts = value.split(":");
  if (mode === "hms") {
    return [parts[0] ?? "", parts[1] ?? "", parts[2] ?? ""];
  }
  return [parts[0] ?? "", parts[1] ?? ""];
}

/** Reassemble segments into a time string */
function formatSegments(mode: "hms" | "ms", segments: string[]): string {
  if (mode === "hms") {
    return `${segments[0] || ""}:${segments[1] || ""}:${segments[2] || ""}`;
  }
  return `${segments[0] || ""}:${segments[1] || ""}`;
}
