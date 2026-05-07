"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Users } from "lucide-react";

interface PartnerWorkoutToggleProps {
  isPartner: boolean;
  partnerCount: string;
  onChange: (updates: { isPartner?: boolean; partnerCount?: string }) => void;
  /** Smaller form chrome for nested contexts. */
  compact?: boolean;
}

// Workout-level "perform with a partner / team" block. Used on:
//   - SmartBuilder review step
//   - admin BenchmarkForm
//   - BenchmarkPreview (override before adding from a benchmark)
//   - WorkoutParser (override before saving a parsed workout)
//
// When the toggle flips on, partner count defaults to 2; flipping off
// clears the count so we don't carry a stale value to the API.
export function PartnerWorkoutToggle({
  isPartner,
  partnerCount,
  onChange,
  compact = false,
}: PartnerWorkoutToggleProps) {
  const labelClass = compact ? "text-xs text-muted-foreground" : "text-sm";
  const inputHeight = compact ? "h-8" : "";

  return (
    <div className="space-y-2 rounded-lg border border-border/40 bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        <Users className="size-4 text-cyan-400" />
        <Label className="text-sm font-medium flex-1">
          Partner / team workout
        </Label>
        <Switch
          checked={isPartner}
          onCheckedChange={(checked) =>
            onChange({
              isPartner: !!checked,
              partnerCount: checked ? partnerCount || "2" : "",
            })
          }
        />
      </div>

      {isPartner && (
        <div className="space-y-1 pl-6">
          <Label className={labelClass}>Team size</Label>
          <Input
            type="number"
            min={2}
            max={20}
            value={partnerCount}
            onChange={(e) => onChange({ partnerCount: e.target.value })}
            placeholder="e.g. 2"
            className={`max-w-[120px] ${inputHeight}`}
          />
        </div>
      )}
    </div>
  );
}
