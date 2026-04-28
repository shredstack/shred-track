"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Trash2,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Loader2,
  Check,
} from "lucide-react";
import { MovementSearch } from "@/components/crossfit/movement-search";
import { useCreateMovement } from "@/hooks/useMovements";
import {
  parseRepScheme,
  canPromoteSequenceToLadder,
} from "@/lib/crossfit/rep-scheme-parser";
import type {
  WorkoutBuilderMovement,
  MovementOption,
  WorkoutType,
} from "@/types/crossfit";

function generateTempId() {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface MovementListBuilderProps {
  movements: WorkoutBuilderMovement[];
  onChange: (movements: WorkoutBuilderMovement[]) => void;
  // For Load workouts have no prescribed weight (the athlete is *finding* the
  // load), so we suppress the Rx weight inputs in that mode.
  workoutType?: WorkoutType;
}

export function MovementListBuilder({
  movements,
  onChange,
  workoutType,
}: MovementListBuilderProps) {
  const showRxWeights = workoutType !== "for_load";
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [creatingName, setCreatingName] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const createMovement = useCreateMovement();

  const toggleExpanded = useCallback((tempId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(tempId)) next.delete(tempId);
      else next.add(tempId);
      return next;
    });
  }, []);

  const addMovement = useCallback(
    (movement: MovementOption) => {
      const newMovement: WorkoutBuilderMovement = {
        tempId: generateTempId(),
        movementId: movement.id,
        movementName: movement.canonicalName,
        category: movement.category,
        isWeighted: movement.isWeighted,
        metricType: movement.metricType,
        prescribedReps: "",
        prescribedWeightMale: movement.commonRxWeightMale || "",
        prescribedWeightFemale: movement.commonRxWeightFemale || "",
        prescribedCaloriesMale: "",
        prescribedCaloriesFemale: "",
        prescribedDistanceMale: "",
        prescribedDistanceFemale: "",
        rxStandard: "",
        notes: "",
      };
      onChange([...movements, newMovement]);
    },
    [movements, onChange]
  );

  // Persist the custom movement to the user's library before adding it to
  // the workout. This gives the builder movement a real `movementId` and
  // makes the name available for future searches.
  const addCustomMovement = useCallback(
    async (name: string) => {
      setCreateError(null);
      setCreatingName(name);
      try {
        const created = await createMovement.mutateAsync({ canonicalName: name });
        const newMovement: WorkoutBuilderMovement = {
          tempId: generateTempId(),
          movementId: created.id,
          movementName: created.canonicalName,
          category: created.category,
          isWeighted: created.isWeighted,
          metricType: created.metricType,
          prescribedReps: "",
          prescribedWeightMale: created.commonRxWeightMale || "",
          prescribedWeightFemale: created.commonRxWeightFemale || "",
          prescribedCaloriesMale: "",
          prescribedCaloriesFemale: "",
          prescribedDistanceMale: "",
          prescribedDistanceFemale: "",
          rxStandard: "",
          notes: "",
        };
        onChange([...movements, newMovement]);
      } catch (err) {
        setCreateError(err instanceof Error ? err.message : "Failed to add movement");
      } finally {
        setCreatingName(null);
      }
    },
    [createMovement, movements, onChange]
  );

  const updateMovement = useCallback(
    (tempId: string, updates: Partial<WorkoutBuilderMovement>) => {
      onChange(
        movements.map((m) => (m.tempId === tempId ? { ...m, ...updates } : m))
      );
    },
    [movements, onChange]
  );

  const removeMovement = useCallback(
    (tempId: string) => {
      onChange(movements.filter((m) => m.tempId !== tempId));
    },
    [movements, onChange]
  );

  const moveMovement = useCallback(
    (tempId: string, direction: "up" | "down") => {
      const idx = movements.findIndex((m) => m.tempId === tempId);
      if (idx === -1) return;
      if (direction === "up" && idx === 0) return;
      if (direction === "down" && idx === movements.length - 1) return;

      const newMovements = [...movements];
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      [newMovements[idx], newMovements[swapIdx]] = [
        newMovements[swapIdx],
        newMovements[idx],
      ];
      onChange(newMovements);
    },
    [movements, onChange]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-base font-semibold">Movements</Label>
        <span className="text-xs text-muted-foreground">
          {movements.length} movement{movements.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Movement list */}
      <div className="space-y-2">
        {movements.map((mov, idx) => {
          const isExpanded = expandedIds.has(mov.tempId);
          return (
            <div
              key={mov.tempId}
              className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-2"
            >
              {/* Header row */}
              <div className="flex items-center gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                  {idx + 1}
                </span>
                <button
                  type="button"
                  className="flex flex-1 items-center gap-1 text-left"
                  onClick={() => toggleExpanded(mov.tempId)}
                >
                  <span className="flex-1 font-medium text-sm">
                    {mov.movementName}
                  </span>
                  <ChevronRight
                    className={`size-3.5 text-muted-foreground transition-transform ${
                      isExpanded ? "rotate-90" : ""
                    }`}
                  />
                </button>
                <div className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => moveMovement(mov.tempId, "up")}
                    disabled={idx === 0}
                  >
                    <ChevronUp className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => moveMovement(mov.tempId, "down")}
                    disabled={idx === movements.length - 1}
                  >
                    <ChevronDown className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => removeMovement(mov.tempId)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>

              {/* Reps — always visible. For_load uses the per-movement rep
                  scheme (e.g. "10-10-7-7-3-3-3" for a deadlift wave). */}
              <RepSchemeField
                value={mov.prescribedReps}
                onChange={(reps) =>
                  updateMovement(mov.tempId, { prescribedReps: reps })
                }
                promoteSequenceToLadder={!!mov.promoteSequenceToLadder}
                onPromoteChange={(promote) =>
                  updateMovement(mov.tempId, {
                    promoteSequenceToLadder: promote,
                  })
                }
                workoutType={workoutType}
              />

              {/* Metric inputs — gender-split, metric-type-aware. */}
              {mov.metricType === "weight" && showRxWeights && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Rx Weight (M)
                    </Label>
                    <Input
                      value={mov.prescribedWeightMale}
                      onChange={(e) =>
                        updateMovement(mov.tempId, {
                          prescribedWeightMale: e.target.value,
                        })
                      }
                      placeholder="e.g. 135"
                      className="h-7 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Rx Weight (F)
                    </Label>
                    <Input
                      value={mov.prescribedWeightFemale}
                      onChange={(e) =>
                        updateMovement(mov.tempId, {
                          prescribedWeightFemale: e.target.value,
                        })
                      }
                      placeholder="e.g. 95"
                      className="h-7 text-xs"
                    />
                  </div>
                </div>
              )}

              {mov.metricType === "calories" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Cals (M)
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      value={mov.prescribedCaloriesMale}
                      onChange={(e) =>
                        updateMovement(mov.tempId, {
                          prescribedCaloriesMale: e.target.value,
                        })
                      }
                      placeholder="e.g. 15"
                      className="h-7 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Cals (F)
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      value={mov.prescribedCaloriesFemale}
                      onChange={(e) =>
                        updateMovement(mov.tempId, {
                          prescribedCaloriesFemale: e.target.value,
                        })
                      }
                      placeholder="e.g. 12"
                      className="h-7 text-xs"
                    />
                  </div>
                </div>
              )}

              {mov.metricType === "distance" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Distance (M) — meters
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      value={mov.prescribedDistanceMale}
                      onChange={(e) =>
                        updateMovement(mov.tempId, {
                          prescribedDistanceMale: e.target.value,
                        })
                      }
                      placeholder="e.g. 400"
                      className="h-7 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Distance (F) — meters
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      value={mov.prescribedDistanceFemale}
                      onChange={(e) =>
                        updateMovement(mov.tempId, {
                          prescribedDistanceFemale: e.target.value,
                        })
                      }
                      placeholder="e.g. 320"
                      className="h-7 text-xs"
                    />
                  </div>
                </div>
              )}

              {/* Implements per rep — only relevant for handheld pairs (1 vs 2
                  dumbbells/kettlebells). Barbells, sandbags, machines have an
                  implicit count of 1, so the toggle is just noise. */}
              {mov.isWeighted &&
                (mov.category === "dumbbell" ||
                  mov.category === "kettlebell") && (
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">
                      {mov.category === "dumbbell"
                        ? "Dumbbells per rep"
                        : "Kettlebells per rep"}
                    </Label>
                    <div className="flex gap-1">
                      {[1, 2].map((n) => {
                        const selected = (mov.equipmentCount ?? 1) === n;
                        return (
                          <button
                            key={n}
                            type="button"
                            onClick={() =>
                              updateMovement(mov.tempId, {
                                equipmentCount: n === 1 ? undefined : n,
                              })
                            }
                            className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                              selected
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted/50 text-muted-foreground hover:bg-muted"
                            }`}
                          >
                            {n}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

              {/* Expanded fields — metric type, weighted toggle, rx standard */}
              {isExpanded && (
                <div className="space-y-2 pt-1">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Metric type
                    </Label>
                    <div className="flex flex-wrap gap-1">
                      {(
                        ["reps", "weight", "calories", "distance"] as const
                      ).map((mt) => {
                        const selected = mov.metricType === mt;
                        return (
                          <button
                            key={mt}
                            type="button"
                            onClick={() => {
                              const updates: Partial<WorkoutBuilderMovement> = {
                                metricType: mt,
                              };
                              // Keep isWeighted in sync with metric type so the
                              // for_load per-set weight UI continues to surface
                              // for weighted movements without a separate toggle.
                              if (mt === "weight") updates.isWeighted = true;
                              if (mt === "calories" || mt === "distance")
                                updates.isWeighted = false;
                              updateMovement(mov.tempId, updates);
                            }}
                            className={`rounded-md px-2 py-0.5 text-xs font-medium capitalize ${
                              selected
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted/50 text-muted-foreground hover:bg-muted"
                            }`}
                          >
                            {mt}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Rx Standard / Notes
                    </Label>
                    <Input
                      value={mov.rxStandard}
                      onChange={(e) =>
                        updateMovement(mov.tempId, {
                          rxStandard: e.target.value,
                        })
                      }
                      placeholder="e.g. Full squat, Chest to deck"
                      className="h-7 text-xs"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Movement search / add */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Add Movement</Label>
        <MovementSearch
          onSelect={addMovement}
          onAddNew={addCustomMovement}
          placeholder="Search or type a movement name..."
        />
        {creatingName && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Saving &quot;{creatingName}&quot; to your movements…
          </p>
        )}
        {createError && (
          <p className="text-xs text-destructive">{createError}</p>
        )}
      </div>
    </div>
  );
}

// ============================================
// RepSchemeField
// ============================================
//
// Free-text rep input with a small parser feedback chip and an optional
// "Continue as ladder?" toggle for ascending arithmetic sequences. Parsing
// is purely visual here — the canonical parsed shape is computed
// server-side at write time.

interface RepSchemeFieldProps {
  value: string;
  onChange: (next: string) => void;
  promoteSequenceToLadder: boolean;
  onPromoteChange: (next: boolean) => void;
  workoutType?: WorkoutType;
}

function RepSchemeField({
  value,
  onChange,
  promoteSequenceToLadder,
  onPromoteChange,
  workoutType,
}: RepSchemeFieldProps) {
  const parsed = parseRepScheme(value);
  const promotable = !!(parsed && canPromoteSequenceToLadder(parsed));

  // If the input changes such that the toggle no longer applies (e.g. user
  // edits "3-6-9-12-15" to "3-6-7"), clear the saved intent so the form
  // doesn't carry a stale "promote" flag.
  useEffect(() => {
    if (!promotable && promoteSequenceToLadder) {
      onPromoteChange(false);
    }
  }, [promotable, promoteSequenceToLadder, onPromoteChange]);

  let chip: React.ReactNode = null;
  if (parsed) {
    if (parsed.kind === "fixed") {
      chip = `Fixed: ${parsed.reps}`;
    } else if (parsed.kind === "sequence") {
      chip =
        promotable && promoteSequenceToLadder
          ? `Ladder: ${ladderPreview(parsed.reps[0], parsed.reps[1] - parsed.reps[0])}`
          : `Sequence: ${parsed.reps.join(", ")}`;
    } else if (parsed.kind === "ladder") {
      chip = `Ladder: ${ladderPreview(parsed.start, parsed.step)}`;
    } else if (parsed.kind === "sets") {
      chip = `Sets: ${parsed.sets} × ${parsed.reps}`;
    }
  }

  const isForReps = workoutType === "for_reps";
  const repsLabel =
    workoutType === "for_load"
      ? "Rep Scheme"
      : isForReps
        ? "Reps (optional)"
        : "Reps";
  const repsPlaceholder =
    workoutType === "for_load"
      ? "e.g. 5-5-5-5-5, 10-10-7-7-3-3-3, 1RM"
      : isForReps
        ? "Optional — only set for prescribed movements"
        : "e.g. 21-15-9, 3-6-9-12..., 5x5, 15";

  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{repsLabel}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={repsPlaceholder}
        className="h-7 text-xs"
      />
      {isForReps && !value && (
        <p className="text-[11px] text-muted-foreground/70">
          Leave blank if this movement is scored. Set reps only for capped
          movements (e.g. &quot;10 T2B&quot; before a max-cal row).
        </p>
      )}
      {chip && (
        <p className="flex items-center gap-1 text-[11px] text-emerald-400">
          <Check className="size-3" />
          {chip}
        </p>
      )}
      {promotable && (
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={promoteSequenceToLadder}
            onChange={(e) => onPromoteChange(e.target.checked)}
            className="size-3 cursor-pointer"
          />
          Continue as ladder?
          {!promoteSequenceToLadder &&
            parsed?.kind === "sequence" &&
            parsed.reps.length >= 2 && (
              <span className="text-muted-foreground/70">
                Preview: {ladderPreview(parsed.reps[0], parsed.reps[1] - parsed.reps[0])}
              </span>
            )}
        </label>
      )}
    </div>
  );
}

// Render a few terms past the seed so the user sees the open-ended shape.
function ladderPreview(start: number, step: number, terms = 7): string {
  const out: number[] = [];
  for (let i = 0; i < terms; i++) out.push(start + i * step);
  return `${out.join(", ")}, …`;
}
