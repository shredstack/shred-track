"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { WorkoutTypeSelector } from "@/components/crossfit/workout-type-selector";
import {
  MovementListBuilder,
  type EarlierLoadPart,
} from "@/components/crossfit/movement-list-builder";
import { IntervalsConfig } from "@/components/crossfit/intervals-config";
import { IntervalRotationConfig } from "@/components/crossfit/interval-rotation-config";
import { EmomRotationConfig } from "@/components/crossfit/emom-rotation-config";
import { DurationInput } from "@/components/crossfit/duration-input";
import {
  parseRepScheme,
  canPromoteSequenceToLadder,
} from "@/lib/crossfit/rep-scheme-parser";
import type {
  PartnerWorkMode,
  RoundScoreAggregation,
  WorkoutBuilderBlock,
  WorkoutBuilderMovement,
  WorkoutBuilderPart,
} from "@/types/crossfit";
import {
  PARTNER_WORK_MODES,
  PARTNER_WORK_MODE_LABELS,
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
  /**
   * True when the parent workout is flagged as a partner / team workout.
   * Gates the per-part "partner work mode" picker — there's no point
   * picking a mode on a solo workout.
   */
  isPartnerWorkout?: boolean;
}

export function WorkoutPartConfig({
  part,
  onChange,
  onMovementsChange,
  onBlocksChange,
  showRepScheme = false,
  compact = false,
  earlierLoadParts = [],
  isPartnerWorkout = false,
}: WorkoutPartConfigProps) {
  const labelClass = compact
    ? "text-xs text-muted-foreground"
    : "text-sm";
  const inputHeight = compact ? "h-8" : "";

  // For Reps doubles as a clock-based "N sets" format ("4 sets, on a 3:00
  // clock, rest 3:00 between"). When the user sets more than one set, the
  // time-cap input becomes the per-set clock and a rest-between-sets input
  // appears. Single-set for_reps keeps the plain time-cap semantics.
  const forRepsSets =
    part.workoutType === "for_reps" ? parseInt(part.rounds || "", 10) : NaN;
  const forRepsMultiSet = Number.isFinite(forRepsSets) && forRepsSets > 1;

  // Interval rotation ("a different movement each round") is persisted purely
  // via per-movement `slotIndex`. Track the user's explicit "turn it on"
  // intent here so the checkbox responds before any movement is pinned, and
  // so the per-movement Round selectors in the movement list light up in sync
  // with the rotation panel above it.
  const [intervalRotationEnabled, setIntervalRotationEnabled] = useState(() =>
    part.movements.some((m) => m.slotIndex != null)
  );
  const intervalRotating =
    part.workoutType === "intervals" &&
    (intervalRotationEnabled ||
      part.movements.some((m) => m.slotIndex != null));

  // How many rounds the per-movement dropdown should offer. Prefer the
  // explicit round count; fall back to the highest slot already assigned so a
  // saved workout with rounds unset still renders every pinned movement.
  const intervalRoundCount = useMemo(() => {
    const explicit = parseInt(part.rounds, 10);
    const maxSlot =
      part.movements.reduce(
        (mx, m) => (m.slotIndex != null ? Math.max(mx, m.slotIndex) : mx),
        -1
      ) + 1;
    return Math.max(
      Number.isFinite(explicit) && explicit > 0 ? explicit : 0,
      maxSlot,
      0
    );
  }, [part.rounds, part.movements]);

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

      {/* For Quality — a no-score practice block: a duration on the clock,
          free-text prescription, and optional movements. Used for skill
          work like "On a 10:00 clock: Gymnastics practice, athlete's
          choice." */}
      {part.workoutType === "for_quality" && (
        <>
          <div className="space-y-1.5">
            <Label className={labelClass}>Duration (mm:ss, optional)</Label>
            <DurationInput
              value={part.timeCapInput}
              onChange={(v) => onChange({ timeCapInput: v })}
              placeholder="e.g. 10:00"
              className={inputHeight}
              ariaLabel="Quality block duration"
            />
          </div>
          <div className="space-y-1.5">
            <Label className={labelClass}>Prescription</Label>
            <Textarea
              value={part.partDescription ?? ""}
              onChange={(e) => onChange({ partDescription: e.target.value })}
              placeholder="e.g. Gymnastics practice — athlete's choice of skill."
              rows={3}
              className="resize-y text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              No score is tracked. Movements below are optional — add them if
              you want to anchor the skill work to specific movements.
            </p>
          </div>
        </>
      )}

      {(part.workoutType === "for_time" ||
        part.workoutType === "emom" ||
        part.workoutType === "for_reps") && (
        <div className="space-y-1.5">
          <Label className={labelClass}>
            {part.workoutType === "emom"
              ? "EMOM Duration (mm:ss)"
              : forRepsMultiSet
                ? "Per-set clock (mm:ss)"
                : "Time Cap (mm:ss)"}
          </Label>
          <DurationInput
            value={part.timeCapInput}
            onChange={(v) => onChange({ timeCapInput: v })}
            placeholder={
              part.workoutType === "emom"
                ? "e.g. 20:00"
                : forRepsMultiSet
                  ? "e.g. 3:00"
                  : "Optional"
            }
            className={inputHeight}
            ariaLabel={
              part.workoutType === "emom"
                ? "EMOM duration"
                : forRepsMultiSet
                  ? "Per-set clock"
                  : "Time cap"
            }
          />
          {forRepsMultiSet && (
            <p className="text-[11px] text-muted-foreground">
              Each set runs on this clock. Work through any fixed buy-in
              movements, then max out the movement(s) you mark “Max reps”.
            </p>
          )}
        </div>
      )}

      {part.workoutType === "for_reps" && (
        <div className="space-y-1.5">
          <Label className={labelClass}>Sets (optional)</Label>
          <Input
            type="number"
            min={1}
            value={part.rounds}
            onChange={(e) => onChange({ rounds: e.target.value })}
            placeholder="e.g. 4"
            className={inputHeight}
          />
          <p className="text-[11px] text-muted-foreground">
            Set more than one for a clock-based format (e.g. “4 sets, on a 3:00
            clock”). Score is total reps across all sets.
          </p>
        </div>
      )}

      {part.workoutType === "for_reps" && forRepsMultiSet && (
        <div className="space-y-1.5">
          <Label className={labelClass}>Rest between sets (mm:ss)</Label>
          <DurationInput
            value={part.intervalRestInput ?? ""}
            onChange={(v) => onChange({ intervalRestInput: v })}
            placeholder="e.g. 3:00"
            className={inputHeight}
            ariaLabel="Rest between sets"
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

      {/* EMOM score-by picker. EMOM scoring is genuinely ambiguous — the
          same "every N minutes" clock can be scored by rounds completed, by
          the load lifted (pre-strength skill work), by total reps (rotating
          max-effort), or kept as a free-text note. Default mirrors the legacy
          behavior: max-reps movements → reps, otherwise a free-text note. */}
      {part.workoutType === "emom" &&
        (() => {
          const current =
            part.scoreType ??
            (part.movements.some((m) => m.isMaxReps) ? "reps" : "note");
          const hint =
            current === "rounds"
              ? "Athlete logs rounds completed (e.g. 8 rounds + 5 reps)."
              : current === "load"
                ? "Athlete logs weight per interval; the heaviest ranks the board. Set the lifted movement's weight to athlete-picked."
                : current === "reps"
                  ? "Total reps across all intervals (auto-summed from max-reps movements)."
                  : "Free-text result (e.g. “all rounds unbroken”).";
          return (
            <div className="space-y-1.5">
              <Label className={labelClass}>Score by</Label>
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    { key: "rounds", label: "Rounds" },
                    { key: "load", label: "Load" },
                    { key: "reps", label: "Reps" },
                    { key: "note", label: "Note" },
                  ] as const
                ).map((opt) => {
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
              <p className="text-[11px] text-muted-foreground pt-1">{hint}</p>
            </div>
          );
        })()}

      {part.workoutType === "emom" && (
        <EmomRotationConfig
          movements={part.movements}
          onMovementsChange={onMovementsChange}
          timeCapInput={part.timeCapInput}
          emomIntervalInput={part.emomIntervalInput}
          compact={compact}
        />
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
            suppressTrailingRest={part.suppressTrailingRest ?? false}
            onChange={onChange}
            compact={compact}
          />
          <p className="text-[11px] text-muted-foreground pt-1">
            EMOM-style work + rest cadence. Score is total reps across all rounds.
          </p>
          <IntervalRotationConfig
            movements={part.movements}
            onMovementsChange={onMovementsChange}
            enabled={intervalRotating}
            onEnabledChange={setIntervalRotationEnabled}
            roundCount={intervalRoundCount}
            compact={compact}
          />
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
          to grind through. Also surfaced on EMOM so "X for time, every
          minute do Y" is buildable where users naturally look. */}
      {(part.workoutType === "for_time" ||
        part.workoutType === "amrap" ||
        part.workoutType === "intervals" ||
        part.workoutType === "emom") && (
        <SideCadenceConfig
          intervalInput={part.sideCadenceIntervalInput ?? ""}
          openEnded={!!part.sideCadenceOpenEnded}
          onChange={(updates) => onChange(updates)}
          compact={compact}
          seedIntervalInput={
            part.workoutType === "emom" ? part.emomIntervalInput : undefined
          }
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
        intervalRoundCount={intervalRotating ? intervalRoundCount : undefined}
        showSideCadence={
          (part.workoutType === "for_time" ||
            part.workoutType === "amrap" ||
            part.workoutType === "intervals" ||
            part.workoutType === "emom") &&
          (!!part.sideCadenceIntervalInput &&
            part.sideCadenceIntervalInput.trim() !== "")
        }
      />

      {isPartnerWorkout && (
        <PartnerWorkModePicker
          value={part.partnerWorkMode}
          onChange={(partnerWorkMode) => onChange({ partnerWorkMode })}
          labelClass={labelClass}
        />
      )}

      <RestAfterPartField
        value={part.restAfterInput ?? ""}
        onChange={(restAfterInput) => onChange({ restAfterInput })}
        labelClass={labelClass}
        inputHeight={inputHeight}
      />
    </div>
  );
}

// Per-part picker for how partners share the work. Only mounted when the
// parent workout is flagged as a partner / team workout. Defaults to
// 'any' (share as desired); 'single_at_a_time' opts the part into the
// per-athlete score-entry flow.
function PartnerWorkModePicker({
  value,
  onChange,
  labelClass,
}: {
  value: PartnerWorkMode | undefined;
  onChange: (mode: PartnerWorkMode) => void;
  labelClass: string;
}) {
  const effective: PartnerWorkMode = value ?? "any";
  return (
    <div className="space-y-1.5 rounded-md border border-cyan-500/20 bg-cyan-500/5 p-2.5">
      <Label className={labelClass}>How partners share the work</Label>
      <div className="grid grid-cols-2 gap-1.5">
        {PARTNER_WORK_MODES.map((mode) => {
          const selected = effective === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => onChange(mode)}
              className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                selected
                  ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-200"
                  : "border-border/50 bg-muted/30 text-muted-foreground hover:bg-muted/50"
              }`}
              aria-pressed={selected}
            >
              {PARTNER_WORK_MODE_LABELS[mode]}
            </button>
          );
        })}
      </div>
      {effective === "single_at_a_time" && (
        <p className="text-[11px] text-cyan-300/80">
          Score entry will capture a separate result per athlete.
        </p>
      )}
    </div>
  );
}

// "Rest after this part" disclosure. Always offered; null/empty means no
// rest pill is rendered. Free-text mm:ss; parsed at submit by the same
// duration parser used everywhere else.
function RestAfterPartField({
  value,
  onChange,
  labelClass,
  inputHeight,
}: {
  value: string;
  onChange: (next: string) => void;
  labelClass: string;
  inputHeight: string;
}) {
  return (
    <div className="space-y-1">
      <Label className={labelClass}>Rest after this part (optional)</Label>
      <DurationInput
        value={value}
        onChange={onChange}
        placeholder="e.g. 5:00"
        className={inputHeight}
        ariaLabel="Rest after this part"
      />
      <p className="text-[11px] text-muted-foreground">
        Shown as a Rest pill between this part and the next.
      </p>
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
  seedIntervalInput,
}: {
  intervalInput: string;
  openEnded: boolean;
  onChange: (updates: {
    sideCadenceIntervalInput?: string;
    sideCadenceOpenEnded?: boolean;
  }) => void;
  compact: boolean;
  /**
   * When set, used as the cadence placeholder hint (e.g. the parent EMOM's
   * own interval) so the common "every minute" case is one tap away. We
   * intentionally do NOT auto-write it — an empty interval keeps the part
   * from being mis-flagged as a side-cadence workout.
   */
  seedIntervalInput?: string;
}) {
  const labelClass = compact ? "text-xs text-muted-foreground" : "text-sm";
  const enabled = !!intervalInput && intervalInput.trim() !== "";
  const intervalPlaceholder =
    seedIntervalInput && seedIntervalInput.trim() !== ""
      ? `e.g. ${seedIntervalInput.trim()}`
      : "e.g. 1:00";
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
            placeholder={intervalPlaceholder}
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
