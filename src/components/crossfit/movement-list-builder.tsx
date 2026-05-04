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
  Plus,
  X,
} from "lucide-react";
import { MovementSearch } from "@/components/crossfit/movement-search";
import { DurationInput } from "@/components/crossfit/duration-input";
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
  // When the parent part has a side-cadence configured, show a toggle
  // per movement that lets the user mark it as the side-cadence movement
  // (runs on the cadence rather than as part of the main task).
  showSideCadence?: boolean;
}

export function MovementListBuilder({
  movements,
  onChange,
  workoutType,
  showSideCadence = false,
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
      const heightDefaults = defaultHeightForMovement(movement.canonicalName);
      const newMovement: WorkoutBuilderMovement = {
        tempId: generateTempId(),
        movementId: movement.id,
        movementName: movement.canonicalName,
        category: movement.category,
        isWeighted: movement.isWeighted,
        is1rmApplicable: movement.is1rmApplicable,
        metricType: movement.metricType,
        prescribedReps: "",
        prescribedWeightMale: movement.commonRxWeightMale || "",
        prescribedWeightFemale: movement.commonRxWeightFemale || "",
        prescribedCaloriesMale: "",
        prescribedCaloriesFemale: "",
        prescribedDistanceMale: "",
        prescribedDistanceFemale: "",
        prescribedDurationSecondsMale: "",
        prescribedDurationSecondsFemale: "",
        prescribedHeightInches: "",
        prescribedHeightInchesMale: heightDefaults?.male ?? "",
        prescribedHeightInchesFemale: heightDefaults?.female ?? "",
        prescribedWeightMaleBwMultiplier: "",
        prescribedWeightFemaleBwMultiplier: "",
        tempo: "",
        isMaxReps: false,
        isSideCadence: false,
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
          is1rmApplicable: created.is1rmApplicable,
          metricType: created.metricType,
          prescribedReps: "",
          prescribedWeightMale: created.commonRxWeightMale || "",
          prescribedWeightFemale: created.commonRxWeightFemale || "",
          prescribedCaloriesMale: "",
          prescribedCaloriesFemale: "",
          prescribedDistanceMale: "",
          prescribedDistanceFemale: "",
          prescribedDurationSecondsMale: "",
          prescribedDurationSecondsFemale: "",
          prescribedHeightInches: "",
          prescribedHeightInchesMale: "",
          prescribedHeightInchesFemale: "",
          prescribedWeightMaleBwMultiplier: "",
          prescribedWeightFemaleBwMultiplier: "",
          tempo: "",
          isMaxReps: false,
          isSideCadence: false,
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

              {/* Reps — visible for everything except duration-only
                  movements (Rest, Plank, etc.). For_load uses the
                  per-movement rep scheme (e.g. "10-10-7-7-3-3-3" for a
                  deadlift wave). Suppressed entirely when isMaxReps is
                  on (the count comes from score-entry, per round). */}
              {mov.metricType !== "duration" && !mov.isMaxReps && (
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
                  hasTimeCap={
                    !!mov.prescribedDurationSecondsMale ||
                    !!mov.prescribedDurationSecondsFemale
                  }
                  onAddTimeCap={() =>
                    // Tap reveals duration inputs by default-seeding empty
                    // strings the user can type into. We use ":30" as a
                    // hint by leaving the field empty so the placeholder
                    // shows.
                    updateMovement(mov.tempId, {
                      prescribedDurationSecondsMale: " ",
                    })
                  }
                />
              )}

              {/* Side-cadence toggle — only visible when the part has a
                  side-cadence configured. Marks this movement as the
                  EMOM-style side movement instead of part of the main
                  task (e.g. EMOM 5 burpees while grinding 150 cleans). */}
              {showSideCadence && (
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!mov.isSideCadence}
                    onChange={(e) =>
                      updateMovement(mov.tempId, {
                        isSideCadence: e.target.checked,
                      })
                    }
                    className="size-3 cursor-pointer"
                  />
                  Side cadence (every interval)
                  {mov.isSideCadence && (
                    <span className="rounded bg-cyan-500/15 px-1 py-px text-[10px] font-bold text-cyan-300">
                      EMOM
                    </span>
                  )}
                </label>
              )}

              {/* Max-X toggle — when on, this movement IS the score.
                  Label adapts to the metric type so calorie/distance/duration
                  movements get the right wording (e.g. "Max calories (score)"
                  for a cal row in Fight Gone Bad). */}
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!mov.isMaxReps}
                  onChange={(e) =>
                    updateMovement(mov.tempId, {
                      isMaxReps: e.target.checked,
                      // When toggling on, clear the reps prefix so it
                      // doesn't render alongside the MAX badge. When
                      // toggling off, the user can re-type as needed.
                      ...(e.target.checked
                        ? { prescribedReps: "" }
                        : {}),
                    })
                  }
                  className="size-3 cursor-pointer"
                />
                {mov.metricType === "calories"
                  ? "Max calories (score)"
                  : mov.metricType === "distance"
                    ? "Max distance (score)"
                    : mov.metricType === "duration"
                      ? "Max duration (score)"
                      : "Max reps (score)"}
                {mov.isMaxReps && (
                  <span className="rounded bg-amber-500/15 px-1 py-px text-[10px] font-bold text-amber-300">
                    MAX
                  </span>
                )}
              </label>

              {/* Metric inputs — gender-split, metric-type-aware. */}
              {mov.metricType === "weight" && showRxWeights && (
                <WeightOrBwInputs
                  movement={mov}
                  onUpdate={(updates) =>
                    updateMovement(mov.tempId, updates)
                  }
                />
              )}

              {/* Calories — free text so rep schemes ("75-50-25") work
                  alongside scalars ("21"). Useful for round-based for_time
                  workouts where the cal count varies per round. */}
              {mov.metricType === "calories" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Cals (M)
                    </Label>
                    <Input
                      value={mov.prescribedCaloriesMale}
                      onChange={(e) =>
                        updateMovement(mov.tempId, {
                          prescribedCaloriesMale: e.target.value,
                        })
                      }
                      placeholder="e.g. 15 or 75-50-25"
                      className="h-7 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Cals (F)
                    </Label>
                    <Input
                      value={mov.prescribedCaloriesFemale}
                      onChange={(e) =>
                        updateMovement(mov.tempId, {
                          prescribedCaloriesFemale: e.target.value,
                        })
                      }
                      placeholder="e.g. 12 or 60-40-20"
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
                      value={mov.prescribedDistanceMale}
                      onChange={(e) =>
                        updateMovement(mov.tempId, {
                          prescribedDistanceMale: e.target.value,
                        })
                      }
                      placeholder="e.g. 400 or 800-400-200"
                      className="h-7 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Distance (F) — meters
                    </Label>
                    <Input
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

              {/* Duration metric inputs — gender-split. Visible whenever
                  the movement is "duration"-typed OR the user opted in to
                  a time cap on a reps movement. Rest is special-cased to a
                  single (non-gendered) input — gender splits on rest are
                  theatre. */}
              {isRestMovement(mov) ? (
                <RestDurationField
                  movement={mov}
                  onUpdate={(updates) =>
                    updateMovement(mov.tempId, updates)
                  }
                />
              ) : (
                (mov.metricType === "duration" ||
                  mov.prescribedDurationSecondsMale ||
                  mov.prescribedDurationSecondsFemale) && (
                  <DurationFields
                    movement={mov}
                    onUpdate={(updates) =>
                      updateMovement(mov.tempId, updates)
                    }
                    showClearButton={mov.metricType !== "duration"}
                  />
                )
              )}

              {/* Height — surfaced inline for box jumps / step-ups / deficit
                  pushups, where the prescription is a first-class number.
                  Deficits are typically gender-agnostic so we render a
                  single input; box jumps render the M/F pair (24"/20"). */}
              {isHeightBearing(mov.movementName) &&
                (isHeightDeficit(mov.movementName) ? (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Height (in)
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.5"
                      value={
                        mov.prescribedHeightInchesMale ||
                        mov.prescribedHeightInches
                      }
                      onChange={(e) =>
                        updateMovement(mov.tempId, {
                          prescribedHeightInchesMale: e.target.value,
                          prescribedHeightInchesFemale: e.target.value,
                        })
                      }
                      placeholder="e.g. 4"
                      className="h-7 text-xs"
                    />
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">
                        Height (M) — in
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.5"
                        value={mov.prescribedHeightInchesMale}
                        onChange={(e) =>
                          updateMovement(mov.tempId, {
                            prescribedHeightInchesMale: e.target.value,
                          })
                        }
                        placeholder="e.g. 24"
                        className="h-7 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">
                        Height (F) — in
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.5"
                        value={mov.prescribedHeightInchesFemale}
                        onChange={(e) =>
                          updateMovement(mov.tempId, {
                            prescribedHeightInchesFemale: e.target.value,
                          })
                        }
                        placeholder="e.g. 20"
                        className="h-7 text-xs"
                      />
                    </div>
                  </div>
                ))}

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

              {/* Expanded fields — metric type, weighted toggle, tempo,
                  height, rx standard */}
              {isExpanded && (
                <div className="space-y-2 pt-1">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Metric type
                    </Label>
                    <div className="flex flex-wrap gap-1">
                      {(
                        [
                          "reps",
                          "weight",
                          "calories",
                          "distance",
                          "duration",
                        ] as const
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
                              if (
                                mt === "calories" ||
                                mt === "distance" ||
                                mt === "duration"
                              )
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

                  {/* Tempo — free text. Renders inline next to reps in
                      display surfaces ("10 BS @ 30X1"). */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Tempo (optional)
                    </Label>
                    <Input
                      value={mov.tempo}
                      onChange={(e) =>
                        updateMovement(mov.tempId, { tempo: e.target.value })
                      }
                      placeholder="e.g. 30X1, 21X1"
                      className="h-7 text-xs"
                    />
                  </div>

                  {/* Height — relevant on deficit pushups, box jumps, etc.
                      Always available in expanded; the field is just text
                      so users can type "4" or "4.5". */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Height (in) — optional
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.5"
                      value={mov.prescribedHeightInches}
                      onChange={(e) =>
                        updateMovement(mov.tempId, {
                          prescribedHeightInches: e.target.value,
                        })
                      }
                      placeholder="e.g. 4 (deficit), 24 (box)"
                      className="h-7 text-xs"
                    />
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
  hasTimeCap?: boolean;
  onAddTimeCap?: () => void;
}

function RepSchemeField({
  value,
  onChange,
  promoteSequenceToLadder,
  onPromoteChange,
  workoutType,
  hasTimeCap,
  onAddTimeCap,
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
      {/* + Time cap — surface only on reps-metric movements that don't
          already carry a duration. Lets users prescribe "10 BS in :40" or
          "15 burpees in :40". */}
      {!hasTimeCap && onAddTimeCap && workoutType !== "for_load" && (
        <button
          type="button"
          onClick={onAddTimeCap}
          className="inline-flex items-center gap-1 text-[11px] text-primary/80 hover:text-primary"
        >
          <Plus className="size-3" />
          Add time cap
        </button>
      )}
    </div>
  );
}

// ============================================
// WeightOrBwInputs
// ============================================
//
// The weight metric block. Default mode shows the gendered lb pair; the
// "Use × BW" toggle (only available on 1RM-applicable barbell lifts)
// swaps to the BW-multiplier inputs. Mutually exclusive at the UI level
// so users can't accidentally set both.

function WeightOrBwInputs({
  movement,
  onUpdate,
}: {
  movement: WorkoutBuilderMovement;
  onUpdate: (updates: Partial<WorkoutBuilderMovement>) => void;
}) {
  const useBw = !!movement.useBwMultiplier;
  // BW multiplier notation only makes sense on barbell 1RMs ("1.5× BW
  // back squat"). Hide the toggle elsewhere so users don't tag a
  // pull-up as "1.5× BW".
  const canUseBw = !!movement.is1rmApplicable;

  return (
    <div className="space-y-1.5">
      {!useBw ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Rx Weight (M)
            </Label>
            <Input
              value={movement.prescribedWeightMale}
              onChange={(e) =>
                onUpdate({ prescribedWeightMale: e.target.value })
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
              value={movement.prescribedWeightFemale}
              onChange={(e) =>
                onUpdate({ prescribedWeightFemale: e.target.value })
              }
              placeholder="e.g. 95"
              className="h-7 text-xs"
            />
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              × Bodyweight (M)
            </Label>
            <Input
              type="number"
              min={0}
              step="0.05"
              value={movement.prescribedWeightMaleBwMultiplier}
              onChange={(e) =>
                onUpdate({
                  prescribedWeightMaleBwMultiplier: e.target.value,
                })
              }
              placeholder="e.g. 1.5"
              className="h-7 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              × Bodyweight (F)
            </Label>
            <Input
              type="number"
              min={0}
              step="0.05"
              value={movement.prescribedWeightFemaleBwMultiplier}
              onChange={(e) =>
                onUpdate({
                  prescribedWeightFemaleBwMultiplier: e.target.value,
                })
              }
              placeholder="e.g. 1.25"
              className="h-7 text-xs"
            />
          </div>
        </div>
      )}
      {canUseBw && (
        <button
          type="button"
          onClick={() =>
            onUpdate(
              useBw
                ? {
                    useBwMultiplier: false,
                    prescribedWeightMaleBwMultiplier: "",
                    prescribedWeightFemaleBwMultiplier: "",
                  }
                : {
                    useBwMultiplier: true,
                    prescribedWeightMale: "",
                    prescribedWeightFemale: "",
                  }
            )
          }
          className="text-[11px] text-primary/80 hover:text-primary"
        >
          {useBw ? "Use lb instead" : "Use × BW instead"}
        </button>
      )}
    </div>
  );
}

// ============================================
// DurationFields
// ============================================
//
// Gender-split duration inputs. Used for "duration"-metric movements
// (Rest, Plank, etc.) and for time-capped reps movements (the "+ Time
// cap" path).

function DurationFields({
  movement,
  onUpdate,
  showClearButton,
}: {
  movement: WorkoutBuilderMovement;
  onUpdate: (updates: Partial<WorkoutBuilderMovement>) => void;
  showClearButton: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            Duration (M)
          </Label>
          <DurationInput
            value={movement.prescribedDurationSecondsMale ?? ""}
            onChange={(v) =>
              onUpdate({ prescribedDurationSecondsMale: v })
            }
            placeholder=":30 or 1:30"
            className="h-7 text-xs"
            ariaLabel="Prescribed duration (male)"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            Duration (F)
          </Label>
          <DurationInput
            value={movement.prescribedDurationSecondsFemale ?? ""}
            onChange={(v) =>
              onUpdate({ prescribedDurationSecondsFemale: v })
            }
            placeholder=":30 or 1:30"
            className="h-7 text-xs"
            ariaLabel="Prescribed duration (female)"
          />
        </div>
      </div>
      {showClearButton && (
        <button
          type="button"
          onClick={() =>
            onUpdate({
              prescribedDurationSecondsMale: "",
              prescribedDurationSecondsFemale: "",
            })
          }
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <X className="size-3" />
          Remove time cap
        </button>
      )}
    </div>
  );
}

// Movements where an Rx height is meaningful (box jump, step-up, deficit
// pushup/HSPU). The list is intentionally narrow — not every movement
// gets a height field surfaced in the picker.
const HEIGHT_BEARING_NAME = /^(box jump( over)?|box step-?up|step-?up|deficit (push-?up|hspu|handstand push-?up))$/i;

function isHeightBearing(name: string | undefined): boolean {
  if (!name) return false;
  return HEIGHT_BEARING_NAME.test(name.trim());
}

function defaultHeightForMovement(
  name: string
): { male: string; female: string } | null {
  const n = name.trim().toLowerCase();
  if (/^(box jump( over)?|box step-?up|step-?up)$/.test(n)) {
    return { male: "24", female: "20" };
  }
  if (/^deficit (push-?up|hspu|handstand push-?up)$/.test(n)) {
    return { male: "4", female: "4" };
  }
  return null;
}

function isHeightDeficit(name: string | undefined): boolean {
  return !!name && /^deficit /i.test(name.trim());
}

// Rest is a duration-typed movement whose gender split has no meaning —
// athletes just rest. We render a single input and mirror the value into
// both gendered columns on save so the existing API path persists it.
function isRestMovement(m: WorkoutBuilderMovement): boolean {
  return (
    m.metricType === "duration" &&
    /^rest$/i.test((m.movementName ?? "").trim())
  );
}

function RestDurationField({
  movement,
  onUpdate,
}: {
  movement: WorkoutBuilderMovement;
  onUpdate: (updates: Partial<WorkoutBuilderMovement>) => void;
}) {
  // Surface whichever side has a value so reopening an existing rest works
  // even if only one column was populated by an older write path.
  const value =
    movement.prescribedDurationSecondsMale ||
    movement.prescribedDurationSecondsFemale ||
    "";
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">Rest duration</Label>
      <DurationInput
        value={value}
        onChange={(v) =>
          onUpdate({
            prescribedDurationSecondsMale: v,
            prescribedDurationSecondsFemale: v,
          })
        }
        placeholder="e.g. 1:00 between rounds"
        className="h-7 text-xs"
        ariaLabel="Rest duration"
      />
    </div>
  );
}

// Render a few terms past the seed so the user sees the open-ended shape.
function ladderPreview(start: number, step: number, terms = 7): string {
  const out: number[] = [];
  for (let i = 0; i < terms; i++) out.push(start + i * step);
  return `${out.join(", ")}, …`;
}
