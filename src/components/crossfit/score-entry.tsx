"use client";

import { useState, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Save, Trophy } from "lucide-react";
import { SetWeightBreakdown } from "@/components/crossfit/set-weight-breakdown";
import type {
  WorkoutPartDisplay,
  ScoreInput,
  MovementScaling,
  ScoreDisplay,
} from "@/types/crossfit";
import { WORKOUT_TYPE_LABELS } from "@/types/crossfit";

const MAX_SET_INPUTS = 15;

// Each modification type declares which contextual input (if any) it exposes.
// - `weight` → numeric "Weight used (lb)" input
// - `reps`   → text "Reps / time completed" input (supports "2 min practice")
// - `none`   → notes only
type ScalingFieldType = "weight" | "reps" | "none";

interface ScalingModification {
  value: string;
  fieldType: ScalingFieldType;
  repsLabel?: string;
  repsPlaceholder?: string;
}

const MODIFICATION_OPTIONS: ScalingModification[] = [
  { value: "Lighter weight", fieldType: "weight" },
  {
    value: "Fewer reps",
    fieldType: "reps",
    repsLabel: "Reps / time completed",
    repsPlaceholder: 'e.g. "50" or "2 min practice"',
  },
  {
    value: "Alternate movement",
    fieldType: "reps",
    repsLabel: "What you did",
    repsPlaceholder: 'e.g. "2 min DU practice", "Singles"',
  },
  { value: "Banded", fieldType: "none" },
  { value: "Ring rows", fieldType: "none" },
  { value: "Jumping", fieldType: "none" },
  { value: "Strict", fieldType: "none" },
  { value: "Kipping", fieldType: "none" },
  { value: "Box-assisted", fieldType: "none" },
  { value: "Reduced ROM", fieldType: "none" },
  { value: "Step-ups instead", fieldType: "none" },
  { value: "Singles instead", fieldType: "none" },
  { value: "Other", fieldType: "none" },
];

const MODIFICATION_BY_VALUE = new Map(
  MODIFICATION_OPTIONS.map((m) => [m.value, m])
);

// ============================================
// Per-part state
// ============================================

interface PartState {
  // null = user hasn't picked yet; required before save
  division: "rx" | "scaled" | "rx_plus" | null;
  timeSeconds?: number;
  hitTimeCap: boolean;
  totalReps: string;
  rounds: string;
  remainderReps: string;
  weightLbs: string;
  scoreText: string;
  rpe: number;
  notes: string;
  // Keyed by **movement_id** (not workout_movement_id) so the same movement
  // appearing multiple times in a part only needs one scaling entry. On save,
  // this scaling is spread to every workout_movement occurrence of that movement.
  movementScalings: Record<string, Partial<MovementScaling>>;
  // Keyed by workout_movement_id — set weights are per-occurrence (one row
  // per barbell per set in a for_load part).
  setWeightsMap: Record<string, string[]>;
}

function emptyPartState(
  part: WorkoutPartDisplay | null,
  existing?: ScoreDisplay | null
): PartState {
  const scalings: Record<string, Partial<MovementScaling>> = {};
  const setWeightsMap: Record<string, string[]> = {};

  // Walk existing movementDetails (keyed by workout_movement_id) and collapse
  // down to one entry per movement_id. Different occurrences of the same
  // movement are expected to share scaling — if they diverge, the first one
  // wins (rare; acceptable fidelity loss).
  if (existing?.movementDetails && part) {
    const wmIdToMovementId = new Map<string, string>();
    for (const mov of part.movements) wmIdToMovementId.set(mov.id, mov.movementId);
    for (const d of existing.movementDetails) {
      const mId = wmIdToMovementId.get(d.workoutMovementId);
      if (mId && !scalings[mId]) {
        scalings[mId] = {
          wasRx: d.wasRx,
          actualWeight: d.actualWeight,
          actualReps: d.actualReps,
          modification: d.modification,
          substitutionMovementId: d.substitutionMovementId,
          notes: d.notes,
        };
      }
      if (d.setWeights && d.setWeights.length > 0) {
        setWeightsMap[d.workoutMovementId] = d.setWeights.map((w) => w.toString());
      }
    }
  }
  return {
    division: existing?.division ?? null,
    timeSeconds: existing?.timeSeconds,
    hitTimeCap: existing?.hitTimeCap ?? false,
    totalReps: existing?.totalReps?.toString() ?? "",
    rounds: existing?.rounds?.toString() ?? "",
    remainderReps: existing?.remainderReps?.toString() ?? "",
    weightLbs: existing?.weightLbs ?? "",
    scoreText: existing?.scoreText ?? "",
    rpe: existing?.rpe ?? 7,
    notes: existing?.notes ?? "",
    movementScalings: scalings,
    setWeightsMap,
  };
}

// Returns one movement per distinct movement_id, in first-occurrence order.
function distinctMovements(part: WorkoutPartDisplay) {
  const seen = new Set<string>();
  const out: typeof part.movements = [];
  for (const m of part.movements) {
    if (seen.has(m.movementId)) continue;
    seen.add(m.movementId);
    out.push(m);
  }
  return out;
}

// ============================================
// Helpers
// ============================================

function setsFromRepScheme(repScheme?: string): number {
  if (!repScheme) return 1;
  const parts = repScheme.split("-").filter((s) => /^\d+$/.test(s.trim()));
  if (parts.length > 0) return Math.min(parts.length, MAX_SET_INPUTS);
  return 1;
}

function repsPerSetFromRepScheme(repScheme?: string): number {
  if (!repScheme) return 1;
  const parts = repScheme.split("-").filter((s) => /^\d+$/.test(s.trim()));
  if (parts.length > 0) {
    // Use the last set's reps for e1RM (usually the heaviest working set).
    return parseInt(parts[parts.length - 1], 10);
  }
  return 1;
}

// The TimeInput owns its own string drafts so the user can type "06" in
// seconds without the browser stripping the leading zero (the old type="number"
// input did). On mount we seed from `value`; we never re-sync afterwards — the
// parent is expected to remount the component with a `key` when it wants to
// load a fresh value (e.g. switching between parts).
function TimeInput({
  value,
  onChange,
  label,
}: {
  value: number | undefined;
  onChange: (seconds: number | undefined) => void;
  label: string;
}) {
  const [minDraft, setMinDraft] = useState(() =>
    value !== undefined ? Math.floor(value / 60).toString() : ""
  );
  const [secDraft, setSecDraft] = useState(() =>
    value !== undefined ? (value % 60).toString().padStart(2, "0") : ""
  );

  const commit = (m: string, s: string) => {
    if (!m && !s) {
      onChange(undefined);
      return;
    }
    const minutes = parseInt(m) || 0;
    const seconds = Math.min(59, parseInt(s) || 0);
    onChange(minutes * 60 + seconds);
  };

  const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.replace(/\D/g, "").slice(0, 3);
    setMinDraft(v);
    commit(v, secDraft);
  };

  const handleSecChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.replace(/\D/g, "").slice(0, 2);
    setSecDraft(v);
    commit(minDraft, v);
  };

  const handleSecBlur = () => {
    if (secDraft.length === 1) {
      const padded = secDraft.padStart(2, "0");
      setSecDraft(padded);
      commit(minDraft, padded);
    }
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-1.5">
        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={3}
          value={minDraft}
          onChange={handleMinChange}
          placeholder="MM"
          className="w-16 text-center font-mono text-lg"
          autoComplete="off"
        />
        <span className="text-lg font-bold text-muted-foreground">:</span>
        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={2}
          value={secDraft}
          onChange={handleSecChange}
          onBlur={handleSecBlur}
          placeholder="SS"
          className="w-16 text-center font-mono text-lg"
          autoComplete="off"
        />
      </div>
    </div>
  );
}

// ============================================
// Props
// ============================================

interface ScoreEntryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workoutId: string;
  workoutTitle?: string;
  parts: WorkoutPartDisplay[];
  initialPartId?: string;
  onSubmit?: (partId: string, score: ScoreInput) => void;
}

// ============================================
// Component
// ============================================

export function ScoreEntry({
  open,
  onOpenChange,
  workoutId,
  workoutTitle,
  parts,
  initialPartId,
  onSubmit,
}: ScoreEntryProps) {
  const [activePartId, setActivePartId] = useState<string>(
    () => initialPartId ?? parts[0]?.id ?? ""
  );
  const [divisionError, setDivisionError] = useState<string | null>(null);

  // One state slot per part, seeded from each part's existing score.
  // The parent remounts ScoreEntry for each target workout, so initial seeding
  // is sufficient — no re-sync effect needed.
  const [partStates, setPartStates] = useState<Record<string, PartState>>(() => {
    const initial: Record<string, PartState> = {};
    for (const p of parts) initial[p.id] = emptyPartState(p, p.score ?? null);
    return initial;
  });

  const activePart = useMemo(
    () => parts.find((p) => p.id === activePartId) ?? parts[0],
    [parts, activePartId]
  );
  const state = partStates[activePart?.id] ?? emptyPartState(null, null);

  const updateState = useCallback(
    (partId: string, updates: Partial<PartState>) => {
      setPartStates((prev) => ({
        ...prev,
        [partId]: { ...prev[partId], ...updates },
      }));
    },
    []
  );

  const updateMovementScaling = useCallback(
    (partId: string, movId: string, updates: Partial<MovementScaling>) => {
      setPartStates((prev) => ({
        ...prev,
        [partId]: {
          ...prev[partId],
          movementScalings: {
            ...prev[partId].movementScalings,
            [movId]: { ...prev[partId].movementScalings[movId], ...updates },
          },
        },
      }));
    },
    []
  );

  const updateSetWeight = useCallback(
    (partId: string, movId: string, setIdx: number, value: string) => {
      setPartStates((prev) => {
        const current = prev[partId].setWeightsMap[movId] ?? [];
        const updated = [...current];
        updated[setIdx] = value;
        return {
          ...prev,
          [partId]: {
            ...prev[partId],
            setWeightsMap: {
              ...prev[partId].setWeightsMap,
              [movId]: updated,
            },
          },
        };
      });
    },
    []
  );

  // ============================================
  // Build and submit ScoreInput per part
  // ============================================

  const buildScoreInput = useCallback(
    (
      part: WorkoutPartDisplay,
      st: PartState & { division: NonNullable<PartState["division"]> }
    ): ScoreInput => {
      // Scaling details are only meaningful when the user picked Scaled.
      // For Rx / Rx+, discard any per-movement scaling the user may have
      // left in state (from a prior toggle), but keep setWeights — those
      // are the canonical record of what was lifted on for_load parts.
      const includeScalingDetails = st.division === "scaled";
      const scalings: MovementScaling[] = part.movements.map((mov) => {
        const scaling = st.movementScalings[mov.movementId] ?? {};
        const setWeights = (st.setWeightsMap[mov.id] ?? [])
          .map((w) => parseFloat(w))
          .filter((w) => !isNaN(w) && w > 0);
        return {
          workoutMovementId: mov.id,
          wasRx: includeScalingDetails ? (scaling.wasRx ?? true) : true,
          actualWeight: includeScalingDetails ? scaling.actualWeight : undefined,
          actualReps: includeScalingDetails ? scaling.actualReps : undefined,
          modification: includeScalingDetails ? scaling.modification : undefined,
          substitutionMovementId: includeScalingDetails
            ? scaling.substitutionMovementId
            : undefined,
          setWeights: setWeights.length > 0 ? setWeights : undefined,
          notes: includeScalingDetails ? scaling.notes : undefined,
        };
      });

      const score: ScoreInput = {
        workoutId,
        workoutPartId: part.id,
        division: st.division,
        hitTimeCap: st.hitTimeCap,
        notes: st.notes || undefined,
        rpe: st.rpe,
        movementScalings: scalings,
      };

      switch (part.workoutType) {
        case "for_time":
          if (st.hitTimeCap) {
            score.totalReps = st.totalReps ? parseInt(st.totalReps) : undefined;
            score.timeSeconds = part.timeCapSeconds;
          } else {
            score.timeSeconds = st.timeSeconds;
          }
          break;
        case "amrap":
          score.rounds = st.rounds ? parseInt(st.rounds) : undefined;
          score.remainderReps = st.remainderReps
            ? parseInt(st.remainderReps)
            : undefined;
          break;
        case "for_load": {
          const explicit = st.weightLbs ? parseFloat(st.weightLbs) : undefined;
          const maxFromSets = Math.max(
            0,
            ...scalings.flatMap((s) => s.setWeights ?? [])
          );
          score.weightLbs = explicit ?? (maxFromSets > 0 ? maxFromSets : undefined);
          break;
        }
        case "for_reps":
        case "for_calories":
        case "max_effort":
          score.totalReps = st.totalReps ? parseInt(st.totalReps) : undefined;
          break;
        case "emom":
        case "tabata":
          score.scoreText = st.scoreText || undefined;
          break;
        default:
          score.scoreText = st.scoreText || undefined;
      }

      return score;
    },
    [workoutId]
  );

  const partHasData = useCallback(
    (part: WorkoutPartDisplay, st: PartState): boolean => {
      switch (part.workoutType) {
        case "for_time":
          return st.timeSeconds != null || st.hitTimeCap;
        case "amrap":
          return !!st.rounds || !!st.remainderReps;
        case "for_load":
          return (
            !!st.weightLbs ||
            Object.values(st.setWeightsMap).some((ws) =>
              ws.some((w) => parseFloat(w) > 0)
            )
          );
        case "for_reps":
        case "for_calories":
        case "max_effort":
          return !!st.totalReps;
        default:
          return !!st.scoreText;
      }
    },
    []
  );

  const handleSubmit = () => {
    // Every part with data must have a division picked. If one doesn't,
    // jump to it so the user sees the inline error.
    const missing = parts.find((part) => {
      const st = partStates[part.id];
      return !!st && partHasData(part, st) && st.division === null;
    });
    if (missing) {
      setActivePartId(missing.id);
      setDivisionError("Please select a division before saving.");
      return;
    }

    for (const part of parts) {
      const st = partStates[part.id];
      if (!st) continue;
      if (!partHasData(part, st)) continue;
      if (st.division === null) continue;
      const score = buildScoreInput(part, { ...st, division: st.division });
      onSubmit?.(part.id, score);
    }
    onOpenChange(false);
  };

  // ============================================
  // Render scoring inputs for the active part
  // ============================================

  if (!activePart) return null;
  const isEditing = !!activePart.score;
  const workoutType = activePart.workoutType;

  const renderScoreInputs = () => {
    switch (workoutType) {
      case "for_time":
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Switch
                checked={state.hitTimeCap}
                onCheckedChange={(checked) =>
                  updateState(activePart.id, { hitTimeCap: !!checked })
                }
              />
              <Label className="text-sm">Hit time cap</Label>
              {state.hitTimeCap && activePart.timeCapSeconds && (
                <span className="text-xs text-muted-foreground">
                  ({Math.floor(activePart.timeCapSeconds / 60)}:
                  {(activePart.timeCapSeconds % 60).toString().padStart(2, "0")})
                </span>
              )}
            </div>

            {state.hitTimeCap ? (
              <div className="space-y-2">
                <Label htmlFor="se-total-reps">Total Reps Completed</Label>
                <Input
                  id="se-total-reps"
                  type="number"
                  min={0}
                  value={state.totalReps}
                  onChange={(e) =>
                    updateState(activePart.id, { totalReps: e.target.value })
                  }
                  placeholder="e.g. 102"
                />
              </div>
            ) : (
              <TimeInput
                key={`time-${activePart.id}`}
                value={state.timeSeconds}
                onChange={(v) => updateState(activePart.id, { timeSeconds: v })}
                label="Completion Time"
              />
            )}
          </div>
        );

      case "amrap":
        return (
          <div className="grid gap-4 grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="se-rounds">Rounds</Label>
              <Input
                id="se-rounds"
                type="number"
                min={0}
                value={state.rounds}
                onChange={(e) =>
                  updateState(activePart.id, { rounds: e.target.value })
                }
                placeholder="e.g. 5"
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="se-extra-reps">+ Extra Reps</Label>
              <Input
                id="se-extra-reps"
                type="number"
                min={0}
                value={state.remainderReps}
                onChange={(e) =>
                  updateState(activePart.id, { remainderReps: e.target.value })
                }
                placeholder="e.g. 12"
                className="font-mono"
              />
            </div>
            {state.rounds && (
              <div className="col-span-2 text-center">
                <span className="font-mono text-lg font-semibold text-foreground">
                  {state.rounds} rds
                  {state.remainderReps ? ` + ${state.remainderReps} reps` : ""}
                </span>
              </div>
            )}
          </div>
        );

      case "for_load": {
        const sets = setsFromRepScheme(activePart.repScheme);
        const repsPerSet = repsPerSetFromRepScheme(activePart.repScheme);
        return (
          <div className="space-y-4">
            {/* Per-movement set weights — the canonical data */}
            {activePart.movements
              .filter((m) => m.isWeighted)
              .map((mov) => {
                const weights = state.setWeightsMap[mov.id] ?? [];
                const numericWeights = weights.map(
                  (w) => parseFloat(w) || 0
                );
                return (
                  <div
                    key={mov.id}
                    className="space-y-2 rounded-lg border border-border/50 bg-muted/20 p-3"
                  >
                    <Label className="text-xs font-medium">
                      {mov.movementName}
                      {activePart.repScheme && (
                        <span className="ml-1 text-muted-foreground font-normal">
                          · {activePart.repScheme}
                        </span>
                      )}
                    </Label>
                    <div
                      className="grid gap-1.5"
                      style={{
                        gridTemplateColumns: `repeat(${Math.min(sets, 5)}, minmax(0, 1fr))`,
                      }}
                    >
                      {Array.from({ length: sets }, (_, i) => (
                        <Input
                          key={i}
                          type="number"
                          value={weights[i] ?? ""}
                          onChange={(e) =>
                            updateSetWeight(
                              activePart.id,
                              mov.id,
                              i,
                              e.target.value
                            )
                          }
                          placeholder={`Set ${i + 1}`}
                          className="h-8 text-xs font-mono text-center"
                        />
                      ))}
                    </div>
                    <SetWeightBreakdown
                      setWeights={numericWeights}
                      repsPerSet={repsPerSet}
                    />
                  </div>
                );
              })}

            {activePart.movements.filter((m) => m.isWeighted).length === 0 && (
              <div className="space-y-2">
                <Label htmlFor="se-weight">Max Weight (lb)</Label>
                <Input
                  id="se-weight"
                  type="number"
                  min={0}
                  value={state.weightLbs}
                  onChange={(e) =>
                    updateState(activePart.id, { weightLbs: e.target.value })
                  }
                  placeholder="e.g. 225"
                  className="font-mono text-lg"
                />
              </div>
            )}
          </div>
        );
      }

      case "for_reps":
      case "for_calories":
      case "max_effort":
        return (
          <div className="space-y-2">
            <Label htmlFor="se-total">
              {workoutType === "for_calories" ? "Total Calories" : "Total Reps"}
            </Label>
            <Input
              id="se-total"
              type="number"
              min={0}
              value={state.totalReps}
              onChange={(e) =>
                updateState(activePart.id, { totalReps: e.target.value })
              }
              placeholder="e.g. 150"
              className="font-mono text-lg"
            />
          </div>
        );

      case "emom":
        return (
          <div className="space-y-2">
            <Label htmlFor="se-emom-score">Score / Notes</Label>
            <Input
              id="se-emom-score"
              value={state.scoreText}
              onChange={(e) =>
                updateState(activePart.id, { scoreText: e.target.value })
              }
              placeholder="e.g. Completed all rounds, or 8/10 rounds completed"
            />
          </div>
        );

      case "tabata":
        return (
          <div className="space-y-2">
            <Label htmlFor="se-tabata-score">Lowest Round / Total Reps</Label>
            <Input
              id="se-tabata-score"
              value={state.scoreText}
              onChange={(e) =>
                updateState(activePart.id, { scoreText: e.target.value })
              }
              placeholder="e.g. Lowest: 8, Total: 92"
            />
          </div>
        );

      default:
        return (
          <div className="space-y-2">
            <Label htmlFor="se-free">Score</Label>
            <Input
              id="se-free"
              value={state.scoreText}
              onChange={(e) =>
                updateState(activePart.id, { scoreText: e.target.value })
              }
              placeholder="Enter your score..."
            />
          </div>
        );
    }
  };

  const multiPart = parts.length > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10">
              <Trophy className="size-3.5 text-primary" />
            </div>
            {isEditing ? "Edit Score" : "Log Score"}
          </DialogTitle>
          <DialogDescription>
            {workoutTitle || "Workout"}
            {!multiPart && ` · ${WORKOUT_TYPE_LABELS[workoutType]}`}
          </DialogDescription>
        </DialogHeader>

        {/* Part switcher */}
        {multiPart && (
          <div className="flex flex-wrap gap-1.5 rounded-lg border border-border/50 bg-muted/20 p-1">
            {parts.map((p, idx) => {
              const isActive = p.id === activePart.id;
              const label = p.label || `Part ${String.fromCharCode(65 + idx)}`;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActivePartId(p.id)}
                  className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  {label}
                  <span className="ml-1 opacity-70">
                    · {WORKOUT_TYPE_LABELS[p.workoutType]}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="space-y-6">
          {/* Division */}
          <div className="space-y-2">
            <Label>
              Division <span className="text-destructive">*</span>
            </Label>
            <div className="flex gap-2">
              {(["rx", "scaled", "rx_plus"] as const).map((div) => {
                const labels = { rx: "Rx", scaled: "Scaled", rx_plus: "Rx+" };
                const isActive = state.division === div;
                return (
                  <Button
                    key={div}
                    type="button"
                    variant={isActive ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      updateState(activePart.id, { division: div });
                      setDivisionError(null);
                    }}
                    className="flex-1"
                  >
                    {labels[div]}
                  </Button>
                );
              })}
            </div>
            {divisionError && (
              <p className="text-xs text-destructive">{divisionError}</p>
            )}
          </div>

          {/* Type-specific inputs */}
          {renderScoreInputs()}

          <Separator />

          {/* Per-movement scaling — shown automatically when division is Scaled */}
          {activePart.movements.length > 0 && state.division === "scaled" && (
            <div className="space-y-4">
              <Label className="text-sm">Scaling details</Label>
              <div className="space-y-3">
                  {distinctMovements(activePart).map((mov) => {
                    const scaling = state.movementScalings[mov.movementId] ?? {};
                    const selectedMod = scaling.modification
                      ? MODIFICATION_BY_VALUE.get(scaling.modification)
                      : undefined;
                    const occurrenceCount = activePart.movements.filter(
                      (m) => m.movementId === mov.movementId
                    ).length;

                    return (
                      <div
                        key={mov.movementId}
                        className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">
                            {mov.movementName}
                            {occurrenceCount > 1 && (
                              <span className="ml-1.5 text-[10px] text-muted-foreground font-normal">
                                (×{occurrenceCount} in workout)
                              </span>
                            )}
                          </span>
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              scaling.wasRx === false
                                ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/30"
                                : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                            }`}
                          >
                            {scaling.wasRx === false ? "Scaled" : "Rx"}
                          </Badge>
                        </div>

                        <div className="flex items-center gap-3">
                          <Switch
                            checked={scaling.wasRx !== false}
                            onCheckedChange={(checked) =>
                              updateMovementScaling(
                                activePart.id,
                                mov.movementId,
                                { wasRx: !!checked }
                              )
                            }
                            size="sm"
                          />
                          <Label className="text-xs text-muted-foreground">
                            As prescribed
                          </Label>
                        </div>

                        {scaling.wasRx === false && (
                          <div className="space-y-2 pt-1">
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">
                                How did you scale?
                              </Label>
                              <Select
                                value={scaling.modification || ""}
                                onValueChange={(val) =>
                                  updateMovementScaling(
                                    activePart.id,
                                    mov.movementId,
                                    {
                                      modification: val || undefined,
                                      // Clear the contextual field when switching modification type
                                      actualWeight: undefined,
                                      actualReps: undefined,
                                    }
                                  )
                                }
                              >
                                <SelectTrigger className="h-7 text-xs">
                                  <SelectValue placeholder="Select how you scaled..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {MODIFICATION_OPTIONS.map((mod) => (
                                    <SelectItem key={mod.value} value={mod.value}>
                                      {mod.value}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            {/* Contextual field driven by modification choice */}
                            {selectedMod?.fieldType === "weight" && (
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">
                                  Weight used (lb)
                                </Label>
                                <Input
                                  type="number"
                                  value={scaling.actualWeight ?? ""}
                                  onChange={(e) =>
                                    updateMovementScaling(
                                      activePart.id,
                                      mov.movementId,
                                      {
                                        actualWeight: e.target.value
                                          ? parseFloat(e.target.value)
                                          : undefined,
                                      }
                                    )
                                  }
                                  placeholder={
                                    mov.prescribedWeightMale
                                      ? `Rx: ${mov.prescribedWeightMale} lb`
                                      : "Weight used"
                                  }
                                  className="h-7 text-xs font-mono"
                                />
                              </div>
                            )}

                            {selectedMod?.fieldType === "reps" && (
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">
                                  {selectedMod.repsLabel ?? "Reps / time completed"}
                                </Label>
                                <Input
                                  value={scaling.actualReps ?? ""}
                                  onChange={(e) =>
                                    updateMovementScaling(
                                      activePart.id,
                                      mov.movementId,
                                      {
                                        actualReps: e.target.value || undefined,
                                      }
                                    )
                                  }
                                  placeholder={
                                    selectedMod.repsPlaceholder ??
                                    (mov.prescribedReps
                                      ? `Rx: ${mov.prescribedReps}`
                                      : "Reps completed")
                                  }
                                  className="h-7 text-xs"
                                />
                              </div>
                            )}

                            {/* Freeform notes — always available */}
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">
                                Notes
                              </Label>
                              <Textarea
                                value={scaling.notes ?? ""}
                                onChange={(e) =>
                                  updateMovementScaling(
                                    activePart.id,
                                    mov.movementId,
                                    {
                                      notes: e.target.value || undefined,
                                    }
                                  )
                                }
                                placeholder="Any context on this scale..."
                                rows={2}
                                className="text-xs"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          <Separator />

          {/* RPE */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>RPE (Rate of Perceived Exertion)</Label>
              <span className="font-mono text-sm font-semibold text-primary">
                {state.rpe}/10
              </span>
            </div>
            <Slider
              value={[state.rpe]}
              onValueChange={(val) =>
                updateState(activePart.id, {
                  rpe: Array.isArray(val) ? val[0] : val,
                })
              }
              min={1}
              max={10}
              step={1}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Easy</span>
              <span>Moderate</span>
              <span>Max Effort</span>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="se-notes">Notes</Label>
            <Textarea
              id="se-notes"
              value={state.notes}
              onChange={(e) =>
                updateState(activePart.id, { notes: e.target.value })
              }
              placeholder="How did it feel? What went well? What to improve?"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} className="w-full sm:w-auto">
            <Save className="size-4" />
            {multiPart
              ? isEditing
                ? "Update All"
                : "Save All"
              : isEditing
                ? "Update Score"
                : "Save Score"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
