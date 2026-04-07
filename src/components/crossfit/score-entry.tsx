"use client";

import { useState, useCallback } from "react";
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
import type {
  WorkoutType,
  WorkoutMovementDisplay,
  ScoreInput,
  MovementScaling,
} from "@/types/crossfit";
import { WORKOUT_TYPE_LABELS } from "@/types/crossfit";

// ============================================
// Props
// ============================================

interface ScoreEntryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workoutId: string;
  workoutTitle?: string;
  workoutType: WorkoutType;
  timeCapSeconds?: number;
  movements: WorkoutMovementDisplay[];
  onSubmit?: (score: ScoreInput) => void;
}

// ============================================
// Time Input Helper
// ============================================

function TimeInput({
  value,
  onChange,
  label,
}: {
  value: number | undefined;
  onChange: (seconds: number | undefined) => void;
  label: string;
}) {
  const minutes = value !== undefined ? Math.floor(value / 60).toString() : "";
  const seconds = value !== undefined ? (value % 60).toString().padStart(2, "0") : "";

  const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const min = parseInt(e.target.value) || 0;
    const sec = value !== undefined ? value % 60 : 0;
    onChange(min * 60 + sec);
  };

  const handleSecChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sec = Math.min(59, parseInt(e.target.value) || 0);
    const min = value !== undefined ? Math.floor(value / 60) : 0;
    onChange(min * 60 + sec);
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min={0}
          value={minutes}
          onChange={handleMinChange}
          placeholder="MM"
          className="w-16 text-center font-mono"
        />
        <span className="text-lg font-bold text-muted-foreground">:</span>
        <Input
          type="number"
          min={0}
          max={59}
          value={seconds}
          onChange={handleSecChange}
          placeholder="SS"
          className="w-16 text-center font-mono"
        />
      </div>
    </div>
  );
}

// ============================================
// Scaling Modifications
// ============================================

const COMMON_MODIFICATIONS = [
  "Banded",
  "Ring rows",
  "Jumping",
  "Strict",
  "Kipping",
  "Box-assisted",
  "Reduced ROM",
  "Lighter weight",
  "Fewer reps",
  "Step-ups instead",
  "Singles instead",
  "Other",
];

// ============================================
// Component
// ============================================

export function ScoreEntry({
  open,
  onOpenChange,
  workoutId,
  workoutTitle,
  workoutType,
  timeCapSeconds,
  movements,
  onSubmit,
}: ScoreEntryProps) {
  // Core score state
  const [division, setDivision] = useState<"rx" | "scaled" | "rx_plus">("rx");
  const [timeSeconds, setTimeSeconds] = useState<number | undefined>();
  const [hitTimeCap, setHitTimeCap] = useState(false);
  const [totalReps, setTotalReps] = useState<string>("");
  const [rounds, setRounds] = useState<string>("");
  const [remainderReps, setRemainderReps] = useState<string>("");
  const [weightLbs, setWeightLbs] = useState<string>("");
  const [scoreText, setScoreText] = useState<string>("");
  const [rpe, setRpe] = useState<number>(7);
  const [notes, setNotes] = useState<string>("");

  // Scaling state
  const [showScaling, setShowScaling] = useState(false);
  const [movementScalings, setMovementScalings] = useState<
    Record<string, Partial<MovementScaling>>
  >({});

  // For Load: per-set weights
  const [setWeightsMap, setSetWeightsMap] = useState<Record<string, string[]>>({});

  const updateMovementScaling = useCallback(
    (movId: string, updates: Partial<MovementScaling>) => {
      setMovementScalings((prev) => ({
        ...prev,
        [movId]: { ...prev[movId], ...updates },
      }));
    },
    []
  );

  const updateSetWeight = useCallback(
    (movId: string, setIdx: number, value: string) => {
      setSetWeightsMap((prev) => {
        const current = prev[movId] || [];
        const updated = [...current];
        updated[setIdx] = value;
        return { ...prev, [movId]: updated };
      });
    },
    []
  );

  const handleSubmit = () => {
    const scalings: MovementScaling[] = movements.map((mov) => {
      const scaling = movementScalings[mov.id] || {};
      return {
        workoutMovementId: mov.id,
        wasRx: scaling.wasRx ?? true,
        actualWeight: scaling.actualWeight,
        actualReps: scaling.actualReps,
        modification: scaling.modification,
        substitutionMovementId: scaling.substitutionMovementId,
        setWeights: setWeightsMap[mov.id]?.map((w) => parseFloat(w) || 0),
        notes: scaling.notes,
      };
    });

    const score: ScoreInput = {
      workoutId,
      division,
      hitTimeCap,
      notes: notes || undefined,
      rpe,
      movementScalings: scalings,
    };

    // Set score fields based on workout type
    switch (workoutType) {
      case "for_time":
        if (hitTimeCap) {
          score.totalReps = totalReps ? parseInt(totalReps) : undefined;
          score.timeSeconds = timeCapSeconds;
        } else {
          score.timeSeconds = timeSeconds;
        }
        break;
      case "amrap":
        score.rounds = rounds ? parseInt(rounds) : undefined;
        score.remainderReps = remainderReps
          ? parseInt(remainderReps)
          : undefined;
        break;
      case "for_load":
        score.weightLbs = weightLbs ? parseFloat(weightLbs) : undefined;
        break;
      case "for_reps":
      case "for_calories":
      case "max_effort":
        score.totalReps = totalReps ? parseInt(totalReps) : undefined;
        break;
      case "emom":
        score.scoreText = scoreText || undefined;
        break;
      default:
        score.scoreText = scoreText || undefined;
    }

    onSubmit?.(score);
    onOpenChange(false);
  };

  // Calculate e1RM for for_load
  const calculateE1RM = (weight: number, reps: number): number => {
    if (reps === 1) return weight;
    // Brzycki formula
    return Math.round(weight * (36 / (37 - reps)));
  };

  // ============================================
  // Render score inputs by workout type
  // ============================================

  const renderScoreInputs = () => {
    switch (workoutType) {
      case "for_time":
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Switch
                checked={hitTimeCap}
                onCheckedChange={(checked) => setHitTimeCap(!!checked)}
              />
              <Label className="text-sm">Hit time cap</Label>
              {hitTimeCap && timeCapSeconds && (
                <span className="text-xs text-muted-foreground">
                  ({Math.floor(timeCapSeconds / 60)}:
                  {(timeCapSeconds % 60).toString().padStart(2, "0")})
                </span>
              )}
            </div>

            {hitTimeCap ? (
              <div className="space-y-2">
                <Label htmlFor="se-total-reps">Total Reps Completed</Label>
                <Input
                  id="se-total-reps"
                  type="number"
                  min={0}
                  value={totalReps}
                  onChange={(e) => setTotalReps(e.target.value)}
                  placeholder="e.g. 102"
                />
              </div>
            ) : (
              <TimeInput
                value={timeSeconds}
                onChange={setTimeSeconds}
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
                value={rounds}
                onChange={(e) => setRounds(e.target.value)}
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
                value={remainderReps}
                onChange={(e) => setRemainderReps(e.target.value)}
                placeholder="e.g. 12"
                className="font-mono"
              />
            </div>
            {rounds && (
              <div className="col-span-2 text-center">
                <span className="font-mono text-lg font-semibold text-foreground">
                  {rounds} rds{remainderReps ? ` + ${remainderReps} reps` : ""}
                </span>
              </div>
            )}
          </div>
        );

      case "for_load":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="se-weight">Max Weight (lb)</Label>
              <Input
                id="se-weight"
                type="number"
                min={0}
                value={weightLbs}
                onChange={(e) => setWeightLbs(e.target.value)}
                placeholder="e.g. 225"
                className="font-mono text-lg"
              />
            </div>

            {/* Per-movement set weights for for_load */}
            {movements
              .filter((m) => m.isWeighted)
              .map((mov) => {
                const sets = mov.prescribedReps
                  ? mov.prescribedReps.split("-").length
                  : 1;
                const weights = setWeightsMap[mov.id] || [];
                const maxWeight = Math.max(
                  ...weights.map((w) => parseFloat(w) || 0),
                  0
                );

                return (
                  <div key={mov.id} className="space-y-2 rounded-lg border border-border/50 bg-muted/20 p-3">
                    <Label className="text-xs font-medium">{mov.movementName}</Label>
                    <div className="grid gap-2 grid-cols-5">
                      {Array.from({ length: Math.min(sets, 5) }, (_, i) => (
                        <Input
                          key={i}
                          type="number"
                          value={weights[i] || ""}
                          onChange={(e) =>
                            updateSetWeight(mov.id, i, e.target.value)
                          }
                          placeholder={`Set ${i + 1}`}
                          className="h-7 text-xs font-mono text-center"
                        />
                      ))}
                    </div>
                    {maxWeight > 0 && (
                      <div className="flex gap-3 text-[10px] text-muted-foreground">
                        <span>Max: {maxWeight} lb</span>
                        {sets > 1 && (
                          <span>
                            e1RM: {calculateE1RM(maxWeight, sets)} lb
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        );

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
              value={totalReps}
              onChange={(e) => setTotalReps(e.target.value)}
              placeholder="e.g. 150"
              className="font-mono text-lg"
            />
          </div>
        );

      case "emom":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="se-emom-score">Score / Notes</Label>
              <Input
                id="se-emom-score"
                value={scoreText}
                onChange={(e) => setScoreText(e.target.value)}
                placeholder="e.g. Completed all rounds, or 8/10 rounds completed"
              />
            </div>
          </div>
        );

      case "tabata":
        return (
          <div className="space-y-2">
            <Label htmlFor="se-tabata-score">Lowest Round / Total Reps</Label>
            <Input
              id="se-tabata-score"
              value={scoreText}
              onChange={(e) => setScoreText(e.target.value)}
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
              value={scoreText}
              onChange={(e) => setScoreText(e.target.value)}
              placeholder="Enter your score..."
            />
          </div>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="size-4 text-primary" />
            Log Score
          </DialogTitle>
          <DialogDescription>
            {workoutTitle || "Workout"} &middot;{" "}
            {WORKOUT_TYPE_LABELS[workoutType]}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Division */}
          <div className="space-y-2">
            <Label>Division</Label>
            <div className="flex gap-2">
              {(["rx", "scaled", "rx_plus"] as const).map((div) => {
                const labels = { rx: "Rx", scaled: "Scaled", rx_plus: "Rx+" };
                const isActive = division === div;
                return (
                  <Button
                    key={div}
                    type="button"
                    variant={isActive ? "default" : "outline"}
                    size="sm"
                    onClick={() => setDivision(div)}
                    className="flex-1"
                  >
                    {labels[div]}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Score Input */}
          {renderScoreInputs()}

          <Separator />

          {/* Scaling Toggle */}
          {movements.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Switch
                  checked={showScaling}
                  onCheckedChange={(checked) => {
                    setShowScaling(!!checked);
                    if (checked && division === "rx") {
                      setDivision("scaled");
                    }
                  }}
                />
                <Label className="text-sm">I scaled something</Label>
              </div>

              {showScaling && (
                <div className="space-y-3">
                  {movements.map((mov) => {
                    const scaling = movementScalings[mov.id] || {};
                    return (
                      <div
                        key={mov.id}
                        className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">
                            {mov.movementName}
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
                              updateMovementScaling(mov.id, {
                                wasRx: !!checked,
                              })
                            }
                            size="sm"
                          />
                          <Label className="text-xs text-muted-foreground">
                            As prescribed
                          </Label>
                        </div>

                        {scaling.wasRx === false && (
                          <div className="space-y-2 pt-1">
                            {mov.isWeighted && (
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">
                                  Actual Weight (lb)
                                </Label>
                                <Input
                                  type="number"
                                  value={scaling.actualWeight ?? ""}
                                  onChange={(e) =>
                                    updateMovementScaling(mov.id, {
                                      actualWeight: e.target.value
                                        ? parseFloat(e.target.value)
                                        : undefined,
                                    })
                                  }
                                  placeholder={
                                    mov.prescribedWeightMale
                                      ? `Rx: ${mov.prescribedWeightMale} lb`
                                      : "Weight used"
                                  }
                                  className="h-7 text-xs"
                                />
                              </div>
                            )}

                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">
                                Actual Reps
                              </Label>
                              <Input
                                value={scaling.actualReps ?? ""}
                                onChange={(e) =>
                                  updateMovementScaling(mov.id, {
                                    actualReps: e.target.value || undefined,
                                  })
                                }
                                placeholder={
                                  mov.prescribedReps
                                    ? `Rx: ${mov.prescribedReps}`
                                    : "Reps completed"
                                }
                                className="h-7 text-xs"
                              />
                            </div>

                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">
                                Modification
                              </Label>
                              <Select
                                value={scaling.modification || ""}
                                onValueChange={(val) =>
                                  updateMovementScaling(mov.id, {
                                    modification: val || undefined,
                                  })
                                }
                              >
                                <SelectTrigger className="h-7 text-xs">
                                  <SelectValue placeholder="Select modification..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {COMMON_MODIFICATIONS.map((mod) => (
                                    <SelectItem key={mod} value={mod}>
                                      {mod}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <Separator />

          {/* RPE */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>RPE (Rate of Perceived Exertion)</Label>
              <span className="font-mono text-sm font-semibold text-primary">
                {rpe}/10
              </span>
            </div>
            <Slider
              value={[rpe]}
              onValueChange={(val) => setRpe(Array.isArray(val) ? val[0] : val)}
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
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="How did it feel? What went well? What to improve?"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} className="w-full sm:w-auto">
            <Save className="size-4" />
            Save Score
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
