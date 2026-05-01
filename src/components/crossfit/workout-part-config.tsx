"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkoutTypeSelector } from "@/components/crossfit/workout-type-selector";
import { MovementListBuilder } from "@/components/crossfit/movement-list-builder";
import { IntervalsConfig } from "@/components/crossfit/intervals-config";
import type {
  WorkoutBuilderMovement,
  WorkoutBuilderPart,
} from "@/types/crossfit";

// ============================================
// Shared workout-part configuration
// ============================================
//
// Renders the type-specific configuration for a single part of a workout —
// workout type, time cap, AMRAP duration, EMOM interval, rounds, structure,
// rep scheme, and the movement list.
//
// Used by:
//   - SmartBuilder.PartCard (wraps this with the multi-part chrome)
//   - AdminBenchmarks form (single-part benchmark editor)
//   - Anywhere else that needs to configure a workout part
//
// Why centralize: when we add a new workout-type-specific field (e.g. the
// recently-added Tabata `structure` and `rounds`), it lights up everywhere
// that uses this component — no risk of the admin form drifting behind the
// Smart Builder.

export interface WorkoutPartConfigProps {
  part: WorkoutBuilderPart;
  onChange: (updates: Partial<WorkoutBuilderPart>) => void;
  onMovementsChange: (movements: WorkoutBuilderMovement[]) => void;
  /**
   * When true, surfaces a "Rep Scheme" text input. The Smart Builder
   * intentionally hides this on parts (rep scheme is per-movement there);
   * the admin benchmark editor and the user-facing benchmark form both
   * still want it.
   */
  showRepScheme?: boolean;
  /** Smaller inputs for nested contexts. Defaults to false. */
  compact?: boolean;
}

export function WorkoutPartConfig({
  part,
  onChange,
  onMovementsChange,
  showRepScheme = false,
  compact = false,
}: WorkoutPartConfigProps) {
  const labelClass = compact
    ? "text-xs text-muted-foreground"
    : "text-sm";
  const inputHeight = compact ? "h-8" : "";

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className={labelClass}>Type</Label>
        <WorkoutTypeSelector
          value={part.workoutType}
          onSelect={(type) => onChange({ workoutType: type })}
        />
      </div>

      {(part.workoutType === "for_time" ||
        part.workoutType === "emom" ||
        part.workoutType === "for_reps") && (
        <div className="space-y-1.5">
          <Label className={labelClass}>
            {part.workoutType === "emom"
              ? "EMOM Duration (min)"
              : "Time Cap (min)"}
          </Label>
          <Input
            type="number"
            min={0}
            value={part.timeCapMinutes}
            onChange={(e) => onChange({ timeCapMinutes: e.target.value })}
            placeholder={
              part.workoutType === "emom" ? "e.g. 20" : "Optional"
            }
            className={inputHeight}
          />
        </div>
      )}

      {part.workoutType === "for_reps" && (
        <div className="space-y-1.5">
          <Label className={labelClass}>Structure</Label>
          <div className="flex gap-1">
            {(
              [
                { key: undefined, label: "None" },
                { key: "tabata", label: "Tabata" },
              ] as const
            ).map((opt) => {
              const selected = (part.structure ?? undefined) === opt.key;
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => onChange({ structure: opt.key })}
                  className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                    selected
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {part.structure === "tabata" && (
            <p className="text-[11px] text-muted-foreground pt-1">
              8 rounds × :20 work / :10 rest per movement. Score is total reps
              across all movements.
            </p>
          )}
        </div>
      )}

      {part.workoutType === "amrap" && (
        <div className="space-y-1.5">
          <Label className={labelClass}>AMRAP Duration (min)</Label>
          <Input
            type="number"
            min={1}
            value={part.amrapDurationMinutes}
            onChange={(e) =>
              onChange({ amrapDurationMinutes: e.target.value })
            }
            placeholder="e.g. 12"
            className={inputHeight}
          />
        </div>
      )}

      {part.workoutType === "emom" && (
        <div className="space-y-1.5">
          <Label className={labelClass}>Interval (seconds)</Label>
          <Input
            type="number"
            min={30}
            step={30}
            value={part.emomIntervalSeconds}
            onChange={(e) =>
              onChange({ emomIntervalSeconds: e.target.value })
            }
            placeholder="60"
            className={inputHeight}
          />
        </div>
      )}

      {part.workoutType === "for_time" && (
        <div className="space-y-1.5">
          <Label className={labelClass}>Rounds (optional)</Label>
          <Input
            type="number"
            min={1}
            value={part.rounds}
            onChange={(e) => onChange({ rounds: e.target.value })}
            placeholder="e.g. 5"
            className={inputHeight}
          />
        </div>
      )}

      {part.workoutType === "intervals" && (
        <div className="space-y-1.5">
          <Label className={labelClass}>Interval cadence</Label>
          <IntervalsConfig
            rounds={part.rounds}
            intervalWorkSeconds={part.intervalWorkSeconds}
            intervalRestSeconds={part.intervalRestSeconds}
            onChange={onChange}
            compact={compact}
          />
          <p className="text-[11px] text-muted-foreground pt-1">
            EMOM-style work + rest cadence. Score is total reps across all rounds.
          </p>
        </div>
      )}

      {showRepScheme && (
        <div className="space-y-1.5">
          <Label className={labelClass}>Rep Scheme</Label>
          <Input
            value={part.repScheme}
            onChange={(e) => onChange({ repScheme: e.target.value })}
            placeholder="e.g. 21-15-9 or 5 rounds"
            className={inputHeight}
          />
        </div>
      )}

      <MovementListBuilder
        workoutType={part.workoutType}
        movements={part.movements}
        onChange={onMovementsChange}
      />
    </div>
  );
}
