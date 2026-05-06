"use client";

import { useEffect, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DurationInput } from "@/components/crossfit/duration-input";

interface IntervalRoundDraft {
  workInput: string;
  restInput: string;
}

interface IntervalsConfigProps {
  rounds: string;
  intervalWorkInput: string;
  intervalRestInput: string;
  intervalRounds?: IntervalRoundDraft[];
  onChange: (updates: {
    rounds?: string;
    intervalWorkInput?: string;
    intervalRestInput?: string;
    intervalRounds?: IntervalRoundDraft[] | undefined;
  }) => void;
  compact?: boolean;
}

// Per-round work + rest cadence for the new "intervals" workout type.
// Slotted into WorkoutPartConfig when workoutType === "intervals".
//
// Two modes:
// - Uniform (default): one (work, rest) pair applied to every round
//   (e.g. 8 × 1:00 / 3:00, Gripper Ripper-style).
// - Per-round: an explicit array, one (work, rest) per round, for
//   descending interval ladders (4:00/4:00 → 3:00/3:00 → 2:00/2:00).
export function IntervalsConfig({
  rounds,
  intervalWorkInput,
  intervalRestInput,
  intervalRounds,
  onChange,
  compact = false,
}: IntervalsConfigProps) {
  const labelClass = compact ? "text-xs text-muted-foreground" : "text-sm";
  const inputHeight = compact ? "h-8" : "";
  const perRound = !!intervalRounds;
  const roundCount = useMemo(() => {
    const n = parseInt(rounds, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [rounds]);

  // Auto-grow / -shrink the per-round array when rounds count changes.
  useEffect(() => {
    if (!perRound) return;
    const cur = intervalRounds ?? [];
    if (roundCount === 0) return;
    if (cur.length === roundCount) return;
    if (cur.length < roundCount) {
      const seed: IntervalRoundDraft = {
        workInput: cur[cur.length - 1]?.workInput ?? "",
        restInput: cur[cur.length - 1]?.restInput ?? "",
      };
      const grown = [...cur];
      while (grown.length < roundCount) grown.push({ ...seed });
      onChange({ intervalRounds: grown });
    } else {
      onChange({ intervalRounds: cur.slice(0, roundCount) });
    }
  }, [perRound, roundCount, intervalRounds, onChange]);

  const togglePerRound = (next: boolean) => {
    if (next) {
      const seedWork = intervalWorkInput || "";
      const seedRest = intervalRestInput || "";
      const n = roundCount > 0 ? roundCount : 1;
      const seeded: IntervalRoundDraft[] = Array.from({ length: n }, () => ({
        workInput: seedWork,
        restInput: seedRest,
      }));
      onChange({ intervalRounds: seeded });
    } else {
      // When switching back to uniform, hydrate the top-level fields from
      // round 0 so the user doesn't lose context.
      const first = intervalRounds?.[0];
      onChange({
        intervalRounds: undefined,
        ...(first
          ? {
              intervalWorkInput: first.workInput,
              intervalRestInput: first.restInput,
            }
          : {}),
      });
    }
  };

  const updateRound = (idx: number, patch: Partial<IntervalRoundDraft>) => {
    const cur = intervalRounds ?? [];
    const next = cur.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    onChange({ intervalRounds: next });
  };

  return (
    <div className="space-y-3">
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
        {!perRound && (
          <>
            <div className="space-y-1">
              <Label className={labelClass}>Work per round (mm:ss)</Label>
              <DurationInput
                value={intervalWorkInput}
                onChange={(v) => onChange({ intervalWorkInput: v })}
                placeholder="e.g. 1:00"
                className={inputHeight}
                ariaLabel="Work duration per round"
              />
            </div>
            <div className="space-y-1">
              <Label className={labelClass}>Rest per round (mm:ss)</Label>
              <DurationInput
                value={intervalRestInput}
                onChange={(v) => onChange({ intervalRestInput: v })}
                placeholder="e.g. 3:00"
                className={inputHeight}
                ariaLabel="Rest duration per round"
              />
            </div>
          </>
        )}
      </div>

      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={!perRound}
          onChange={(e) => togglePerRound(!e.target.checked)}
          className="size-3 cursor-pointer"
        />
        Same work / rest every round
      </label>

      {perRound && intervalRounds && (
        <div className="space-y-2 rounded-md border border-border/40 bg-muted/20 p-2">
          {intervalRounds.map((r, i) => (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-3">
              <div className="text-xs font-medium text-muted-foreground self-center">
                Round {i + 1}
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">
                  Work (mm:ss)
                </Label>
                <DurationInput
                  value={r.workInput}
                  onChange={(v) => updateRound(i, { workInput: v })}
                  placeholder="e.g. 4:00"
                  className="h-8"
                  ariaLabel={`Round ${i + 1} work`}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">
                  Rest (mm:ss)
                </Label>
                <DurationInput
                  value={r.restInput}
                  onChange={(v) => updateRound(i, { restInput: v })}
                  placeholder="e.g. 4:00"
                  className="h-8"
                  ariaLabel={`Round ${i + 1} rest`}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
