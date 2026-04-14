"use client";

import { useRef, useCallback } from "react";
import { cn } from "@/lib/utils";

type PaceUnit = "mi" | "km";

interface PaceInputProps {
  /** MM:SS string, e.g. "5:30" */
  value: string;
  onChange: (value: string) => void;
  unit: PaceUnit;
  onUnitChange: (unit: PaceUnit) => void;
  className?: string;
}

/**
 * Structured pace input: two-segment MM:SS with a /mi | /km toggle.
 */
export function PaceInput({
  value,
  onChange,
  unit,
  onUnitChange,
  className,
}: PaceInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const setRef = useCallback(
    (index: number) => (el: HTMLInputElement | null) => {
      refs.current[index] = el;
    },
    [],
  );

  const parts = value.split(":");
  const segments = [parts[0] ?? "", parts[1] ?? ""];

  const handleChange = useCallback(
    (index: number, raw: string) => {
      const digits = raw.replace(/\D/g, "");
      let val = digits.slice(0, 2);
      if (val.length > 0 && parseInt(val, 10) > 59) {
        val = "59";
      }

      const next = [...segments];
      next[index] = val;
      onChange(`${next[0] || ""}:${next[1] || ""}`);

      if (val.length >= 2 && index === 0) {
        refs.current[1]?.focus();
        refs.current[1]?.select();
      }
    },
    [segments, onChange],
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Backspace" && segments[index] === "" && index > 0) {
        e.preventDefault();
        refs.current[index - 1]?.focus();
        refs.current[index - 1]?.select();
      }
      if (e.key === "ArrowLeft" && index > 0) {
        const input = e.currentTarget;
        if (input.selectionStart === 0) {
          e.preventDefault();
          refs.current[index - 1]?.focus();
        }
      }
      if (e.key === "ArrowRight" && index === 0) {
        const input = e.currentTarget;
        if (input.selectionStart === input.value.length) {
          e.preventDefault();
          refs.current[1]?.focus();
        }
      }
    },
    [segments],
  );

  const labels = ["MM", "SS"];
  const placeholders = ["0", "00"];

  return (
    <div className={cn("flex items-end gap-3", className)}>
      {/* Time segments */}
      <div className="inline-flex items-center gap-1">
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-1">
            {i > 0 && (
              <span className="text-sm font-mono text-muted-foreground select-none">
                :
              </span>
            )}
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
              <span className="mt-0.5 text-[10px] text-muted-foreground/60 select-none">
                {labels[i]}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Unit toggle */}
      <UnitToggle
        options={[
          { value: "mi", label: "/mi" },
          { value: "km", label: "/km" },
        ]}
        value={unit}
        onChange={onUnitChange}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared unit toggle (used by PaceInput, DistanceInput, WeightInput)
// ---------------------------------------------------------------------------

interface UnitToggleOption<T extends string> {
  value: T;
  label: string;
}

interface UnitToggleProps<T extends string> {
  options: UnitToggleOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function UnitToggle<T extends string>({
  options,
  value,
  onChange,
}: UnitToggleProps<T>) {
  return (
    <div className="inline-flex rounded-md border border-input bg-background p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
            value === opt.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
