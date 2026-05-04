"use client";

import { useEffect, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DurationInput } from "@/components/crossfit/duration-input";

interface IntervalRoundDraft {
  workSeconds: string;
  restSeconds: string;
}

interface IntervalsConfigProps {
  rounds: string;
  intervalWorkSeconds: string;
  intervalRestSeconds: string;
  intervalRounds?: IntervalRoundDraft[];
  onChange: (updates: {
    rounds?: string;
    intervalWorkSeconds?: string;
    intervalRestSeconds?: string;
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
  intervalWorkSeconds,
  intervalRestSeconds,
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
        workSeconds: cur[cur.length - 1]?.workSeconds ?? "",
        restSeconds: cur[cur.length - 1]?.restSeconds ?? "",
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
      const seedWork = intervalWorkSeconds || "";
      const seedRest = intervalRestSeconds || "";
      const n = roundCount > 0 ? roundCount : 1;
      const seeded: IntervalRoundDraft[] = Array.from({ length: n }, () => ({
        workSeconds: seedWork,
        restSeconds: seedRest,
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
              intervalWorkSeconds: first.workSeconds,
              intervalRestSeconds: first.restSeconds,
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
                  Work
                </Label>
                <DurationInput
                  value={r.workSeconds}
                  onChange={(v) => updateRound(i, { workSeconds: v })}
                  placeholder="e.g. 4:00"
                  className="h-8"
                  ariaLabel={`Round ${i + 1} work`}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">
                  Rest
                </Label>
                <DurationInput
                  value={r.restSeconds}
                  onChange={(v) => updateRound(i, { restSeconds: v })}
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
