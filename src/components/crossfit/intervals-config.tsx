"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DurationInput } from "@/components/crossfit/duration-input";

interface IntervalsConfigProps {
  rounds: string;
  intervalWorkSeconds: string;
  intervalRestSeconds: string;
  onChange: (updates: {
    rounds?: string;
    intervalWorkSeconds?: string;
    intervalRestSeconds?: string;
  }) => void;
  compact?: boolean;
}

// Per-round work + rest cadence for the new "intervals" workout type.
// Slotted into WorkoutPartConfig when workoutType === "intervals".
//
// Example: Gripper Ripper → 8 rounds × 1:00 work / 3:00 rest.
export function IntervalsConfig({
  rounds,
  intervalWorkSeconds,
  intervalRestSeconds,
  onChange,
  compact = false,
}: IntervalsConfigProps) {
  const labelClass = compact ? "text-xs text-muted-foreground" : "text-sm";
  const inputHeight = compact ? "h-8" : "";

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1">
        <Label className={labelClass}>Rounds</Label>
        <Input
          type="number"
          min={1}
          value={rounds}
          onChange={(e) => onChange({ rounds: e.target.value })}
          placeholder="e.g. 8"
          className={inputHeight}
        />
      </div>
      <div className="space-y-1">
        <Label className={labelClass}>Work (per round)</Label>
        <DurationInput
          value={intervalWorkSeconds}
          onChange={(v) => onChange({ intervalWorkSeconds: v })}
          placeholder="e.g. 1:00"
          className={inputHeight}
          ariaLabel="Work duration per round"
        />
      </div>
      <div className="space-y-1">
        <Label className={labelClass}>Rest (per round)</Label>
        <DurationInput
          value={intervalRestSeconds}
          onChange={(v) => onChange({ intervalRestSeconds: v })}
          placeholder="e.g. 3:00"
          className={inputHeight}
          ariaLabel="Rest duration per round"
        />
      </div>
    </div>
  );
}
