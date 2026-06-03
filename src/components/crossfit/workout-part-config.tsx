"use client";

import { useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkoutTypeSelector } from "@/components/crossfit/workout-type-selector";
import {
  MovementListBuilder,
  type EarlierLoadPart,
} from "@/components/crossfit/movement-list-builder";
import { IntervalsConfig } from "@/components/crossfit/intervals-config";
import { DurationInput } from "@/components/crossfit/duration-input";
import {
  parseRepScheme,
  canPromoteSequenceToLadder,
} from "@/lib/crossfit/rep-scheme-parser";
import type {
  RoundScoreAggregation,
  WorkoutBuilderBlock,
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
  onBlocksChange: (blocks: WorkoutBuilderBlock[]) => void;
  /**
   * When true, surfaces a "Rep Scheme" text input. The Smart Builder
   * intentionally hides this on parts (rep scheme is per-movement there);
   * the admin benchmark editor and the user-facing benchmark form both
   * still want it.
   */
  showRepScheme?: boolean;
  /** Smaller inputs for nested contexts. Defaults to false. */
  compact?: boolean;
  /**
   * Earlier for_load parts whose logged max a movement in this part can be
   * prescribed as a percentage of. Empty/undefined hides the weight_pct
   * option. Computed by MultiPartConfig from the parts above this one.
   */
  earlierLoadParts?: EarlierLoadPart[];
}

export function WorkoutPartConfig({
  part,
  onChange,
  onMovementsChange,
  onBlocksChange,
  showRepScheme = false,
  compact = false,
  earlierLoadParts = [],
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
          onSelect={(type) =>
            // `structure` is workout-type-specific (tabata→for_reps,
            // complex→for_load), so a type change always clears it.
            // For timed_rounds, seed a default rounds count (5) and
            // aggregation (slowest) when those fields aren't already
            // populated — saves the user a click for the canonical case.
            onChange({
              workoutType: type,
              structure: undefined,
              ...(type === "timed_rounds"
                ? {
                    rounds: part.rounds || "5",
                    roundScoreAggregation:
                      part.roundScoreAggregation ?? "slowest",
                  }
                : {}),
            })
          }
        />
      </div>

      {(part.workoutType === "for_time" ||
        part.workoutType === "emom" ||
        part.workoutType === "for_reps") && (
        <div className="space-y-1.5">
          <Label className={labelClass}>
            {part.workoutType === "emom"
              ? "EMOM Duration (mm:ss)"
              : "Time Cap (mm:ss)"}
          </Label>
          <DurationInput
            value={part.timeCapInput}
            onChange={(v) => onChange({ timeCapInput: v })}
            placeholder={
              part.workoutType === "emom" ? "e.g. 20:00" : "Optional"
            }
            className={inputHeight}
            ariaLabel={
              part.workoutType === "emom" ? "EMOM duration" : "Time cap"
            }
          />
        </div>
      )}

      {(part.workoutType === "for_reps" ||
        part.workoutType === "for_load") && (
        <div className="space-y-1.5">
          <Label className={labelClass}>Structure</Label>
          <div className="flex gap-1">
            {(part.workoutType === "for_load"
              ? ([
                  { key: undefined, label: "None" },
                  { key: "complex", label: "Complex" },
                ] as const)
              : ([
                  { key: undefined, label: "None" },
                  { key: "tabata", label: "Tabata" },
                ] as const)
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
          {part.structure === "complex" && (
            <p className="text-[11px] text-muted-foreground pt-1">
              Movements are performed back-to-back as one unbroken set — no
              rest between them. Score is the heaviest set.
            </p>
          )}
        </div>
      )}

      {/* Score-by picker — only meaningful when the workout type is
          ambiguous (for_reps/amrap/intervals) AND at least one movement
          in the part is athlete-picked weight. for_time/for_load already
          have unambiguous scoring (time / heaviest load) so the picker
          stays hidden there. */}
      {(part.workoutType === "for_reps" ||
        part.workoutType === "amrap" ||
        part.workoutType === "intervals") &&
        part.movements.some((m) => m.weightSource === "athlete") && (
          <div className="space-y-1.5">
            <Label className={labelClass}>Score by</Label>
            <div className="flex gap-1">
              {(
                [
                  { key: "reps", label: "Reps" },
                  { key: "load", label: "Load" },
                ] as const
              ).map((opt) => {
                const current = part.scoreType ?? "reps";
                const selected = current === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => onChange({ scoreType: opt.key })}
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
            <p className="text-[11px] text-muted-foreground pt-1">
              {(part.scoreType ?? "reps") === "reps"
                ? "Ranks by total reps; heaviest weight shows as a chip."
                : "Ranks by the heaviest weight used across rounds."}
            </p>
          </div>
        )}

      {part.workoutType === "amrap" && (
        <div className="space-y-1.5">
          <Label className={labelClass}>AMRAP Duration (mm:ss)</Label>
          <DurationInput
            value={part.amrapDurationInput}
            onChange={(v) => onChange({ amrapDurationInput: v })}
            placeholder="e.g. 12:00"
            className={inputHeight}
            ariaLabel="AMRAP duration"
          />
        </div>
      )}

      {part.workoutType === "emom" && (
        <div className="space-y-1.5">
          <Label className={labelClass}>Interval (mm:ss)</Label>
          <DurationInput
            value={part.emomIntervalInput}
            onChange={(v) => onChange({ emomIntervalInput: v })}
            placeholder="e.g. 1:00"
            className={inputHeight}
            ariaLabel="EMOM interval"
          />
        </div>
      )}

      {part.workoutType === "timed_rounds" && (
        <TimedRoundsConfig
          rounds={part.rounds}
          roundWindowInput={part.roundWindowInput ?? ""}
          roundScoreAggregation={part.roundScoreAggregation ?? "slowest"}
          onChange={onChange}
          labelClass={labelClass}
          inputHeight={inputHeight}
        />
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

      {/* For Load doubles `rounds` as the prescribed set count. Required
          framing for a complex ("5 sets of…"), optional for a plain lift. */}
      {part.workoutType === "for_load" && (
        <div className="space-y-1.5">
          <Label className={labelClass}>
            {part.structure === "complex" ? "Sets" : "Sets (optional)"}
          </Label>
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
            intervalWorkInput={part.intervalWorkInput}
            intervalRestInput={part.intervalRestInput}
            intervalRounds={part.intervalRounds}
            onChange={onChange}
            compact={compact}
          />
          <p className="text-[11px] text-muted-foreground pt-1">
            EMOM-style work + rest cadence. Score is total reps across all rounds.
          </p>
        </div>
      )}

      {/* Part-level rep scheme. Always surfaced for for_time / amrap so a
          shared scheme like "21-15-9" only has to be typed once and gets
          applied to every movement that doesn't already carry one.
          Other workout types still respect the explicit `showRepScheme`
          flag (set by the admin benchmark editor). */}
      {(showRepScheme ||
        part.workoutType === "for_time" ||
        part.workoutType === "amrap") && (
        <PartRepSchemeField
          part={part}
          onChange={onChange}
          onMovementsChange={onMovementsChange}
          labelClass={labelClass}
          inputHeight={inputHeight}
        />
      )}

      {/* Side-cadence — pairs the part with a recurring on-the-minute
          movement (e.g. "150 DB hang power cleans for time, EMOM 5
          burpees"). Only meaningful on workouts that have a main task
          to grind through. */}
      {(part.workoutType === "for_time" ||
        part.workoutType === "amrap" ||
        part.workoutType === "intervals") && (
        <SideCadenceConfig
          intervalInput={part.sideCadenceIntervalInput ?? ""}
          openEnded={!!part.sideCadenceOpenEnded}
          onChange={(updates) => onChange(updates)}
          compact={compact}
        />
      )}

      <MovementListBuilder
        workoutType={part.workoutType}
        movements={part.movements}
        onChange={onMovementsChange}
        blocks={part.blocks}
        onBlocksChange={onBlocksChange}
        earlierLoadParts={earlierLoadParts}
        partRepScheme={part.repScheme}
        partPromoteSequenceToLadder={part.promoteSequenceToLadder}
        showSideCadence={
          (part.workoutType === "for_time" ||
            part.workoutType === "amrap" ||
            part.workoutType === "intervals") &&
          (!!part.sideCadenceIntervalInput &&
            part.sideCadenceIntervalInput.trim() !== "")
        }
      />
    </div>
  );
}

// Part-level "Rep scheme (applies to all movements)" input. Wraps the
// text field with a "Continue as ladder?" toggle that mirrors the per-
// movement one — saves the user from having to type the scheme into
// every movement just to enable the ladder behavior for an AMRAP.
//
// When the user toggles the part-level promote flag, we propagate it onto
// every movement currently inheriting the part's scheme (i.e. whose
// prescribedReps either matches the part's repScheme or is empty). A
// movement that has its own overridden scheme keeps its own flag.
function PartRepSchemeField({
  part,
  onChange,
  onMovementsChange,
  labelClass,
  inputHeight,
}: {
  part: WorkoutBuilderPart;
  onChange: (updates: Partial<WorkoutBuilderPart>) => void;
  onMovementsChange: (movements: WorkoutBuilderMovement[]) => void;
  labelClass: string;
  inputHeight: string;
}) {
  const parsed = parseRepScheme(part.repScheme);
  const promotable = !!(parsed && canPromoteSequenceToLadder(parsed));
  const promote = !!part.promoteSequenceToLadder;

  const isInheriting = (m: WorkoutBuilderMovement, scheme: string) =>
    !m.prescribedReps?.trim() || m.prescribedReps === scheme;

  // Mirror RepSchemeField: if the input becomes un-promotable (e.g. user
  // edits "3-6-9-12-15" to "3-6-7"), clear the saved intent so the form
  // doesn't carry a stale flag. Also clear it on inheriting movements,
  // since their own RepSchemeField is hidden (the override link path),
  // meaning its own auto-clear effect can't run for them. Done in an
  // effect because side effects during render are forbidden.
  useEffect(() => {
    if (promotable || !promote) return;
    onChange({ promoteSequenceToLadder: false });
    const updated = part.movements.map((m) =>
      isInheriting(m, part.repScheme) && m.promoteSequenceToLadder
        ? { ...m, promoteSequenceToLadder: false }
        : m
    );
    if (updated.some((m, i) => m !== part.movements[i])) {
      onMovementsChange(updated);
    }
    // We only want this to fire on the promotable→un-promotable transition;
    // including `part` would re-fire on every other part edit. The closure
    // reads the latest `part` because PartRepSchemeField re-renders on
    // each part change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promotable, promote]);

  return (
    <div className="space-y-1.5">
      <Label className={labelClass}>
        Rep scheme (applies to all movements)
      </Label>
      <Input
        value={part.repScheme}
        onChange={(e) => {
          const next = e.target.value;
          // Update both the scheme and propagate it onto inheriting
          // movements in a single pass — saves an extra render and keeps
          // the inheriting set stable across keystrokes.
          const prev = part.repScheme;
          onChange({ repScheme: next });
          if (next.trim()) {
            const updated = part.movements.map((m) =>
              isInheriting(m, prev) ? { ...m, prescribedReps: next } : m
            );
            if (updated.some((m, i) => m !== part.movements[i])) {
              onMovementsChange(updated);
            }
          }
        }}
        placeholder="e.g. 21-15-9 or 75-50-25"
        className={inputHeight}
      />
      {promotable && (
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={promote}
            onChange={(e) => {
              const next = e.target.checked;
              onChange({ promoteSequenceToLadder: next });
              // Checking the box is a force-apply: the user is telling us
              // the ladder applies to every movement. Overwrite each
              // movement's scheme + flag so they all snap to the compact
              // chip view (no half-inherited, half-text-box state).
              // Per-movement overrides can still happen after via the
              // "Override reps" link.
              //
              // Unchecking the box just clears the per-movement flag on
              // currently-inheriting movements; we don't blow away the
              // schemes they were inheriting.
              const updated = part.movements.map((m) => {
                if (next) {
                  return {
                    ...m,
                    prescribedReps: part.repScheme,
                    promoteSequenceToLadder: true,
                  };
                }
                return isInheriting(m, part.repScheme)
                  ? { ...m, promoteSequenceToLadder: false }
                  : m;
              });
              if (updated.some((m, i) => m !== part.movements[i])) {
                onMovementsChange(updated);
              }
            }}
            className="size-3 cursor-pointer"
          />
          Continue as ladder?
        </label>
      )}
    </div>
  );
}

// Inline Timed Rounds config block — rounds, optional per-round window,
// and the score-by aggregation strategy. All four aggregations rank with
// "lowest aggregate wins" (consistent with for_time), so the explainer
// makes that explicit to avoid the "what's a good score?" question.
function TimedRoundsConfig({
  rounds,
  roundWindowInput,
  roundScoreAggregation,
  onChange,
  labelClass,
  inputHeight,
}: {
  rounds: string;
  roundWindowInput: string;
  roundScoreAggregation: RoundScoreAggregation;
  onChange: (updates: Partial<WorkoutBuilderPart>) => void;
  labelClass: string;
  inputHeight: string;
}) {
  const aggregations: { key: RoundScoreAggregation; label: string }[] = [
    { key: "slowest", label: "Slowest round" },
    { key: "fastest", label: "Fastest round" },
    { key: "sum", label: "Sum" },
    { key: "average", label: "Average" },
  ];
  const explainer: Record<RoundScoreAggregation, string> = {
    slowest:
      "Lowest aggregate wins. Slowest single round is your score.",
    fastest:
      "Lowest aggregate wins. Fastest single round is your score.",
    sum: "Lowest aggregate wins. Total time across all rounds.",
    average: "Lowest aggregate wins. Average round time.",
  };
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className={labelClass}>Rounds</Label>
        <Input
          type="number"
          min={1}
          max={20}
          value={rounds}
          onChange={(e) => onChange({ rounds: e.target.value })}
          placeholder="e.g. 5"
          className={inputHeight}
        />
      </div>
      <div className="space-y-1.5">
        <Label className={labelClass}>Round window (optional, mm:ss)</Label>
        <DurationInput
          value={roundWindowInput}
          onChange={(v) => onChange({ roundWindowInput: v })}
          placeholder="e.g. 5:00 (Every 5:00)"
          className={inputHeight}
          ariaLabel="Round window"
        />
        <p className="text-[11px] text-muted-foreground pt-0.5">
          When set, the score-entry warns if a round time exceeds the window.
          Leave blank for sprint-repeat style (no enforced cadence).
        </p>
      </div>
      <div className="space-y-1.5">
        <Label className={labelClass}>Score by</Label>
        <div className="flex flex-wrap gap-1">
          {aggregations.map((opt) => {
            const selected = roundScoreAggregation === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => onChange({ roundScoreAggregation: opt.key })}
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
        <p className="text-[11px] text-muted-foreground pt-0.5">
          {explainer[roundScoreAggregation]}
        </p>
      </div>
    </div>
  );
}

// Inline side-cadence config block. Hidden until the user opens the
// "Side cadence (optional)" disclosure so it doesn't clutter the
// non-cadence path.
function SideCadenceConfig({
  intervalInput,
  openEnded,
  onChange,
  compact,
}: {
  intervalInput: string;
  openEnded: boolean;
  onChange: (updates: {
    sideCadenceIntervalInput?: string;
    sideCadenceOpenEnded?: boolean;
  }) => void;
  compact: boolean;
}) {
  const labelClass = compact ? "text-xs text-muted-foreground" : "text-sm";
  const enabled = !!intervalInput && intervalInput.trim() !== "";
  return (
    <details
      className="rounded-md border border-border/40 bg-muted/15 p-2"
      open={enabled}
    >
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
        Side cadence (optional)
      </summary>
      <div className="space-y-2 pt-2">
        <div className="space-y-1">
          <Label className={labelClass}>Cadence interval (mm:ss)</Label>
          <DurationInput
            value={intervalInput}
            onChange={(v) => onChange({ sideCadenceIntervalInput: v })}
            placeholder="e.g. 1:00"
            className={compact ? "h-8" : ""}
            ariaLabel="Side cadence interval"
          />
          <p className="text-[11px] text-muted-foreground">
            Movements you mark as &quot;side cadence&quot; below run on this
            interval while the rest of the movements form the main task.
          </p>
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={openEnded}
            onChange={(e) =>
              onChange({ sideCadenceOpenEnded: e.target.checked })
            }
            className="size-3 cursor-pointer"
          />
          No fixed duration / open-ended (until failure)
        </label>
      </div>
    </details>
  );
}
