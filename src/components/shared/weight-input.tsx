"use client";

import { cn } from "@/lib/utils";
import { UnitToggle } from "./pace-input";

type WeightUnit = "kg" | "lb";

interface WeightInputProps {
  value: string;
  onChange: (value: string) => void;
  unit: WeightUnit;
  onUnitChange: (unit: WeightUnit) => void;
  className?: string;
}

/**
 * Numeric weight input with kg/lb toggle.
 */
export function WeightInput({
  value,
  onChange,
  unit,
  onUnitChange,
  className,
}: WeightInputProps) {
  return (
    <div className={cn("flex items-end gap-3", className)}>
      <div className="flex flex-col">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          placeholder="0"
          onChange={(e) => {
            const raw = e.target.value;
            if (/^\d*\.?\d{0,1}$/.test(raw) || raw === "") {
              onChange(raw);
            }
          }}
          className={cn(
            "w-20 rounded-md border border-input bg-background px-2 py-1.5 text-center font-mono text-sm",
            "ring-offset-background placeholder:text-muted-foreground/50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          )}
        />
        <span className="mt-0.5 text-[10px] text-muted-foreground/60 select-none text-center">
          weight
        </span>
      </div>

      <UnitToggle
        options={[
          { value: "kg", label: "kg" },
          { value: "lb", label: "lb" },
        ]}
        value={unit}
        onChange={onUnitChange}
      />
    </div>
  );
}
