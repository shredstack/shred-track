"use client";

import { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Save,
} from "lucide-react";
import { MovementSearch } from "@/components/crossfit/movement-search";
import type {
  WorkoutType,
  WorkoutBuilderForm,
  WorkoutBuilderMovement,
  MovementOption,
} from "@/types/crossfit";
import { WORKOUT_TYPES, WORKOUT_TYPE_LABELS } from "@/types/crossfit";

// ============================================
// Props
// ============================================

interface WorkoutBuilderProps {
  initialData?: Partial<WorkoutBuilderForm>;
  onSave?: (form: WorkoutBuilderForm) => void;
  onCancel?: () => void;
}

// ============================================
// Helpers
// ============================================

function generateTempId() {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyForm(initial?: Partial<WorkoutBuilderForm>): WorkoutBuilderForm {
  const today = new Date().toISOString().split("T")[0];
  return {
    title: "",
    description: "",
    workoutType: "for_time",
    workoutDate: today,
    timeCapMinutes: "",
    timeCapSeconds: "0",
    amrapDurationMinutes: "",
    repScheme: "",
    movements: [],
    ...initial,
  };
}

// ============================================
// Component
// ============================================

export function WorkoutBuilder({
  initialData,
  onSave,
  onCancel,
}: WorkoutBuilderProps) {
  const [form, setForm] = useState<WorkoutBuilderForm>(() =>
    createEmptyForm(initialData)
  );

  const updateField = useCallback(
    <K extends keyof WorkoutBuilderForm>(key: K, value: WorkoutBuilderForm[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const addMovement = useCallback((movement: MovementOption) => {
    const newMovement: WorkoutBuilderMovement = {
      tempId: generateTempId(),
      movementId: movement.id,
      movementName: movement.canonicalName,
      category: movement.category,
      isWeighted: movement.isWeighted,
      prescribedReps: "",
      prescribedWeightMale: movement.commonRxWeightMale || "",
      prescribedWeightFemale: movement.commonRxWeightFemale || "",
      rxStandard: "",
      notes: "",
    };
    setForm((prev) => ({
      ...prev,
      movements: [...prev.movements, newMovement],
    }));
  }, []);

  const addCustomMovement = useCallback((name: string) => {
    const newMovement: WorkoutBuilderMovement = {
      tempId: generateTempId(),
      movementName: name,
      isWeighted: false,
      prescribedReps: "",
      prescribedWeightMale: "",
      prescribedWeightFemale: "",
      rxStandard: "",
      notes: "",
    };
    setForm((prev) => ({
      ...prev,
      movements: [...prev.movements, newMovement],
    }));
  }, []);

  const updateMovement = useCallback(
    (tempId: string, updates: Partial<WorkoutBuilderMovement>) => {
      setForm((prev) => ({
        ...prev,
        movements: prev.movements.map((m) =>
          m.tempId === tempId ? { ...m, ...updates } : m
        ),
      }));
    },
    []
  );

  const removeMovement = useCallback((tempId: string) => {
    setForm((prev) => ({
      ...prev,
      movements: prev.movements.filter((m) => m.tempId !== tempId),
    }));
  }, []);

  const moveMovement = useCallback((tempId: string, direction: "up" | "down") => {
    setForm((prev) => {
      const idx = prev.movements.findIndex((m) => m.tempId === tempId);
      if (idx === -1) return prev;
      if (direction === "up" && idx === 0) return prev;
      if (direction === "down" && idx === prev.movements.length - 1) return prev;

      const newMovements = [...prev.movements];
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      [newMovements[idx], newMovements[swapIdx]] = [
        newMovements[swapIdx],
        newMovements[idx],
      ];
      return { ...prev, movements: newMovements };
    });
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave?.(form);
  };

  const showTimeCap =
    form.workoutType === "for_time" || form.workoutType === "emom";
  const showAmrapDuration = form.workoutType === "amrap";
  const showRepScheme =
    form.workoutType === "for_time" ||
    form.workoutType === "for_load" ||
    form.workoutType === "amrap";

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Title & Date */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="wb-title">Title</Label>
          <Input
            id="wb-title"
            value={form.title}
            onChange={(e) => updateField("title", e.target.value)}
            placeholder="e.g. Fran, Hero WOD, Tuesday Metcon"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="wb-date">Date</Label>
          <Input
            id="wb-date"
            type="date"
            value={form.workoutDate}
            onChange={(e) => updateField("workoutDate", e.target.value)}
          />
        </div>
      </div>

      {/* Workout Type */}
      <div className="space-y-2">
        <Label>Workout Type</Label>
        <Select
          value={form.workoutType}
          onValueChange={(val) => updateField("workoutType", val as WorkoutType)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WORKOUT_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {WORKOUT_TYPE_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Type-specific fields */}
      {showTimeCap && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="wb-tc-min">
              {form.workoutType === "emom" ? "EMOM Duration (min)" : "Time Cap (min)"}
            </Label>
            <Input
              id="wb-tc-min"
              type="number"
              min={0}
              value={form.timeCapMinutes}
              onChange={(e) => updateField("timeCapMinutes", e.target.value)}
              placeholder="e.g. 20"
            />
          </div>
        </div>
      )}

      {showAmrapDuration && (
        <div className="space-y-2">
          <Label htmlFor="wb-amrap-dur">AMRAP Duration (min)</Label>
          <Input
            id="wb-amrap-dur"
            type="number"
            min={1}
            value={form.amrapDurationMinutes}
            onChange={(e) =>
              updateField("amrapDurationMinutes", e.target.value)
            }
            placeholder="e.g. 12"
          />
        </div>
      )}

      {showRepScheme && (
        <div className="space-y-2">
          <Label htmlFor="wb-rep-scheme">Rep Scheme</Label>
          <Input
            id="wb-rep-scheme"
            value={form.repScheme}
            onChange={(e) => updateField("repScheme", e.target.value)}
            placeholder="e.g. 21-15-9, 5 rounds, 5-5-5-5-5"
          />
        </div>
      )}

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="wb-desc">Description / Notes</Label>
        <Textarea
          id="wb-desc"
          value={form.description}
          onChange={(e) => updateField("description", e.target.value)}
          placeholder="Any additional details about the workout..."
          rows={2}
        />
      </div>

      <Separator />

      {/* Movements */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label className="text-base font-semibold">Movements</Label>
          <span className="text-xs text-muted-foreground">
            {form.movements.length} movement{form.movements.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Movement list */}
        <div className="space-y-3">
          {form.movements.map((mov, idx) => (
            <div
              key={mov.tempId}
              className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-3"
            >
              {/* Header row */}
              <div className="flex items-center gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                  {idx + 1}
                </span>
                <span className="flex-1 font-medium text-sm">
                  {mov.movementName}
                </span>
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
                    disabled={idx === form.movements.length - 1}
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

              {/* Fields */}
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Reps</Label>
                  <Input
                    value={mov.prescribedReps}
                    onChange={(e) =>
                      updateMovement(mov.tempId, {
                        prescribedReps: e.target.value,
                      })
                    }
                    placeholder="e.g. 21, 5x3, 400m"
                    className="h-7 text-xs"
                  />
                </div>
                {mov.isWeighted && (
                  <>
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
                  </>
                )}
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
                  placeholder="e.g. Full squat, Chest to deck, etc."
                  className="h-7 text-xs"
                />
              </div>
            </div>
          ))}
        </div>

        {/* Movement search / add */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Add Movement</Label>
          <MovementSearch
            onSelect={addMovement}
            onAddNew={addCustomMovement}
            placeholder="Search or type a movement name..."
          />
        </div>
      </div>

      <Separator />

      {/* Actions */}
      <div className="flex gap-2">
        <Button type="submit" className="flex-1">
          <Save className="size-4" />
          Save Workout
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
