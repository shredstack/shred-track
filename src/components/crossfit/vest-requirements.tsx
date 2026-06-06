"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shield } from "lucide-react";
import { VEST_REQUIREMENTS, type VestRequirement } from "@/types/crossfit";

const VEST_REQUIREMENT_LABELS: Record<VestRequirement, string> = {
  none: "None",
  optional: "Optional",
  required: "Required",
};

const VEST_REQUIREMENT_HINTS: Record<VestRequirement, string> = {
  none: "No vest in the prescription.",
  optional: "Vest is allowed; wearing it doesn't change Rx.",
  required: "Must wear vest to log as Rx (Murph).",
};

interface VestRequirementsProps {
  vestRequirement: VestRequirement;
  vestWeightMaleLb: string;
  vestWeightFemaleLb: string;
  onChange: (updates: {
    vestRequirement?: VestRequirement;
    vestWeightMaleLb?: string;
    vestWeightFemaleLb?: string;
  }) => void;
  /** Smaller form chrome for nested contexts (e.g. inside SmartBuilder). */
  compact?: boolean;
}

// Workout-level vest prescription. Three-state radio + gendered weight
// inputs when the vest is part of the prescription (required OR optional).
// Used by SmartBuilder, admin BenchmarkForm, gym programming sheet.
export function VestRequirements({
  vestRequirement,
  vestWeightMaleLb,
  vestWeightFemaleLb,
  onChange,
  compact = false,
}: VestRequirementsProps) {
  const labelClass = compact ? "text-xs text-muted-foreground" : "text-sm";
  const inputHeight = compact ? "h-8" : "";
  const showWeights =
    vestRequirement === "required" || vestRequirement === "optional";

  return (
    <div className="space-y-2 rounded-lg border border-border/40 bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        <Shield className="size-4 text-amber-400" />
        <Label className="text-sm font-medium">Weighted vest</Label>
      </div>

      <div className="grid grid-cols-3 gap-1.5 pl-6">
        {VEST_REQUIREMENTS.map((value) => {
          const selected = vestRequirement === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => onChange({ vestRequirement: value })}
              className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                selected
                  ? "border-amber-400/50 bg-amber-400/15 text-amber-300"
                  : "border-border/50 bg-muted/30 text-muted-foreground hover:bg-muted/50"
              }`}
              aria-pressed={selected}
            >
              {VEST_REQUIREMENT_LABELS[value]}
            </button>
          );
        })}
      </div>
      <p className="pl-6 text-[11px] text-muted-foreground">
        {VEST_REQUIREMENT_HINTS[vestRequirement]}
      </p>

      {showWeights && (
        <div className="grid gap-3 pt-1 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className={labelClass}>Vest weight (M, lb)</Label>
            <Input
              type="number"
              min={0}
              step="0.5"
              value={vestWeightMaleLb}
              onChange={(e) =>
                onChange({ vestWeightMaleLb: e.target.value })
              }
              placeholder="e.g. 20"
              className={inputHeight}
            />
          </div>
          <div className="space-y-1">
            <Label className={labelClass}>Vest weight (F, lb)</Label>
            <Input
              type="number"
              min={0}
              step="0.5"
              value={vestWeightFemaleLb}
              onChange={(e) =>
                onChange({ vestWeightFemaleLb: e.target.value })
              }
              placeholder="e.g. 14"
              className={inputHeight}
            />
          </div>
        </div>
      )}
    </div>
  );
}
