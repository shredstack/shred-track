"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Shield } from "lucide-react";

interface VestRequirementsProps {
  requiresVest: boolean;
  vestWeightMaleLb: string;
  vestWeightFemaleLb: string;
  onChange: (updates: {
    requiresVest?: boolean;
    vestWeightMaleLb?: string;
    vestWeightFemaleLb?: string;
  }) => void;
  /** Smaller form chrome for nested contexts (e.g. inside SmartBuilder). */
  compact?: boolean;
}

// Workout-level "requires weighted vest" block. Used on:
//   - SmartBuilder review step
//   - admin BenchmarkForm
//
// When the toggle is off the weight inputs are hidden but their drafts
// are kept around so flipping the toggle back on doesn't lose data.
export function VestRequirements({
  requiresVest,
  vestWeightMaleLb,
  vestWeightFemaleLb,
  onChange,
  compact = false,
}: VestRequirementsProps) {
  const labelClass = compact ? "text-xs text-muted-foreground" : "text-sm";
  const inputHeight = compact ? "h-8" : "";

  return (
    <div className="space-y-2 rounded-lg border border-border/40 bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        <Shield className="size-4 text-amber-400" />
        <Label className="text-sm font-medium flex-1">
          Requires weighted vest
        </Label>
        <Switch
          checked={requiresVest}
          onCheckedChange={(checked) =>
            onChange({ requiresVest: !!checked })
          }
        />
      </div>

      {requiresVest && (
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
