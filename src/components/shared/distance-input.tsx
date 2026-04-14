"use client";

import { cn } from "@/lib/utils";
import { UnitToggle } from "./pace-input";

type DistanceUnit = "mi" | "km";

interface DistanceInputProps {
  value: string;
  onChange: (value: string) => void;
  unit: DistanceUnit;
  onUnitChange: (unit: DistanceUnit) => void;
  className?: string;
}

/**
 * Numeric distance input with mi/km toggle.
 */
export function DistanceInput({
  value,
  onChange,
  unit,
  onUnitChange,
  className,
}: DistanceInputProps) {
  return (
    <div className={cn("flex items-end gap-3", className)}>
      <div className="flex flex-col">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          placeholder="0.00"
          onChange={(e) => {
            // Allow digits and a single decimal point
            const raw = e.target.value;
            if (/^\d*\.?\d{0,2}$/.test(raw) || raw === "") {
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
          distance
        </span>
      </div>

      <UnitToggle
        options={[
          { value: "mi", label: "mi" },
          { value: "km", label: "km" },
        ]}
        value={unit}
        onChange={onUnitChange}
      />
    </div>
  );
}
