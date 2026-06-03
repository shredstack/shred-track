"use client";

import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import {
  parseDurationToSeconds,
  formatSecondsAsClock,
} from "@/lib/crossfit/duration-parser";

interface DurationInputProps {
  /** String draft. Free-text — parsed on blur. */
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  id?: string;
}

// Free-text duration input. Accepts ":30", "1:30", "30s", "1m30s",
// "1.5min", or a bare seconds count. Renders an `mm:ss` preview chip
// underneath when the value parses.
//
// Designed to be a controlled component — the parent owns the string. We
// don't normalize on blur (so the user's typed format survives), but we
// do show the parsed value as a hint so they know what we read.
export function DurationInput({
  value,
  onChange,
  placeholder = "e.g. :30 or 1:30",
  className,
  ariaLabel,
  id,
}: DurationInputProps) {
  const preview = useMemo(() => {
    if (!value.trim()) return null;
    const seconds = parseDurationToSeconds(value);
    return seconds != null ? formatSecondsAsClock(seconds) : null;
  }, [value]);

  return (
    <div className="space-y-0.5">
      <Input
        id={id}
        type="text"
        inputMode="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={className}
        aria-label={ariaLabel}
      />
      {preview && preview !== value.trim() && (
        <p className="text-[10px] text-muted-foreground/70">= {preview}</p>
      )}
    </div>
  );
}
