"use client";

import { useState, useMemo, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Save,
} from "lucide-react";
import { WorkoutTypeSelector } from "@/components/crossfit/workout-type-selector";
import { MovementListBuilder } from "@/components/crossfit/movement-list-builder";
import type {
  WorkoutType,
  WorkoutBuilderForm,
  WorkoutBuilderMovement,
} from "@/types/crossfit";
import { WORKOUT_TYPE_LABELS, WORKOUT_TYPE_COLORS } from "@/types/crossfit";

interface SmartBuilderProps {
  onSave: (form: WorkoutBuilderForm) => void;
  onCancel?: () => void;
}

type Step = "type" | "config" | "movements" | "review";

const STEPS: Step[] = ["type", "config", "movements", "review"];

function createEmptyForm(): WorkoutBuilderForm {
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
  };
}

export function SmartBuilder({ onSave, onCancel }: SmartBuilderProps) {
  const [step, setStep] = useState<Step>("type");
  const [form, setForm] = useState<WorkoutBuilderForm>(createEmptyForm);

  const stepIndex = STEPS.indexOf(step);

  const goBack = useCallback(() => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  }, [step]);

  const goNext = useCallback(() => {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  }, [step]);

  const handleTypeSelect = useCallback(
    (type: WorkoutType) => {
      setForm((prev) => ({ ...prev, workoutType: type }));
      goNext();
    },
    [goNext]
  );

  const handleMovementsChange = useCallback(
    (movements: WorkoutBuilderMovement[]) => {
      setForm((prev) => ({ ...prev, movements }));
    },
    []
  );

  const autoTitle = useMemo(() => {
    if (form.title) return form.title;
    const typeLabel = WORKOUT_TYPE_LABELS[form.workoutType];
    const movementNames = form.movements
      .slice(0, 3)
      .map((m) => m.movementName)
      .join(", ");
    if (movementNames) return `${typeLabel} — ${movementNames}`;
    return typeLabel;
  }, [form.title, form.workoutType, form.movements]);

  const handleSubmit = useCallback(() => {
    onSave({ ...form, title: form.title || autoTitle });
  }, [form, autoTitle, onSave]);

  // Check if we can skip config step (some types need no config)
  const needsConfig =
    form.workoutType === "for_time" ||
    form.workoutType === "amrap" ||
    form.workoutType === "emom" ||
    form.workoutType === "for_load";

  return (
    <div className="space-y-4">
      {/* Progress indicator */}
      <div className="flex items-center gap-1">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-1">
            <div
              className={`flex size-6 items-center justify-center rounded-full text-xs font-medium ${
                i < stepIndex
                  ? "bg-primary text-primary-foreground"
                  : i === stepIndex
                    ? "bg-primary/20 text-primary ring-1 ring-primary/50"
                    : "bg-muted/50 text-muted-foreground"
              }`}
            >
              {i < stepIndex ? <Check className="size-3" /> : i + 1}
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`h-px w-6 ${
                  i < stepIndex ? "bg-primary" : "bg-border"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Workout Type */}
      {step === "type" && (
        <div className="space-y-3">
          <h3 className="font-semibold">What type of workout?</h3>
          <WorkoutTypeSelector
            value={form.workoutType}
            onSelect={handleTypeSelect}
          />
        </div>
      )}

      {/* Step 2: Type-specific Configuration */}
      {step === "config" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={goBack}
            >
              <ArrowLeft className="size-4" />
            </Button>
            <h3 className="font-semibold">Configure</h3>
            <Badge
              variant="outline"
              className={WORKOUT_TYPE_COLORS[form.workoutType]}
            >
              {WORKOUT_TYPE_LABELS[form.workoutType]}
            </Badge>
          </div>

          {(form.workoutType === "for_time" || form.workoutType === "emom") && (
            <div className="space-y-2">
              <Label htmlFor="sb-tc">
                {form.workoutType === "emom"
                  ? "EMOM Duration (min)"
                  : "Time Cap (min)"}
              </Label>
              <Input
                id="sb-tc"
                type="number"
                min={0}
                value={form.timeCapMinutes}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    timeCapMinutes: e.target.value,
                  }))
                }
                placeholder={
                  form.workoutType === "emom" ? "e.g. 20" : "Optional"
                }
              />
            </div>
          )}

          {form.workoutType === "amrap" && (
            <div className="space-y-2">
              <Label htmlFor="sb-amrap">AMRAP Duration (min)</Label>
              <Input
                id="sb-amrap"
                type="number"
                min={1}
                value={form.amrapDurationMinutes}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    amrapDurationMinutes: e.target.value,
                  }))
                }
                placeholder="e.g. 12"
              />
            </div>
          )}

          {(form.workoutType === "for_time" ||
            form.workoutType === "for_load" ||
            form.workoutType === "amrap") && (
            <div className="space-y-2">
              <Label htmlFor="sb-rep">Rep Scheme</Label>
              <Input
                id="sb-rep"
                value={form.repScheme}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    repScheme: e.target.value,
                  }))
                }
                placeholder={
                  form.workoutType === "for_load"
                    ? "e.g. 5-5-5-5-5 or 1RM"
                    : "e.g. 21-15-9 or 5 rounds"
                }
              />
            </div>
          )}

          {form.workoutType === "emom" && (
            <div className="space-y-2">
              <Label htmlFor="sb-interval">Interval (seconds)</Label>
              <Input
                id="sb-interval"
                type="number"
                min={30}
                step={30}
                defaultValue={60}
                placeholder="60"
              />
            </div>
          )}

          <Button type="button" onClick={goNext} className="w-full">
            Next
            <ArrowRight className="size-4" />
          </Button>
        </div>
      )}

      {/* Step 3: Movements */}
      {step === "movements" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={goBack}
            >
              <ArrowLeft className="size-4" />
            </Button>
            <h3 className="font-semibold">Add Movements</h3>
          </div>

          <MovementListBuilder
            movements={form.movements}
            onChange={handleMovementsChange}
          />

          <Button
            type="button"
            onClick={goNext}
            className="w-full"
            disabled={form.movements.length === 0}
          >
            Review
            <ArrowRight className="size-4" />
          </Button>
        </div>
      )}

      {/* Step 4: Review & Save */}
      {step === "review" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={goBack}
            >
              <ArrowLeft className="size-4" />
            </Button>
            <h3 className="font-semibold">Review & Save</h3>
          </div>

          {/* Summary card */}
          <div className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-3">
            <Badge
              variant="outline"
              className={WORKOUT_TYPE_COLORS[form.workoutType]}
            >
              {WORKOUT_TYPE_LABELS[form.workoutType]}
            </Badge>

            {form.repScheme && (
              <p className="text-sm text-muted-foreground">{form.repScheme}</p>
            )}

            {form.timeCapMinutes && (
              <p className="text-sm text-muted-foreground">
                {form.workoutType === "amrap"
                  ? `${form.amrapDurationMinutes} min AMRAP`
                  : form.workoutType === "emom"
                    ? `${form.timeCapMinutes} min EMOM`
                    : `${form.timeCapMinutes} min time cap`}
              </p>
            )}

            {form.amrapDurationMinutes && form.workoutType === "amrap" && (
              <p className="text-sm text-muted-foreground">
                {form.amrapDurationMinutes} min AMRAP
              </p>
            )}

            <Separator />

            <div className="space-y-1">
              {form.movements.map((m, i) => (
                <div key={m.tempId} className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{i + 1}.</span>
                  <span className="font-medium">{m.movementName}</span>
                  {m.prescribedReps && (
                    <span className="text-muted-foreground">
                      — {m.prescribedReps}
                    </span>
                  )}
                  {m.prescribedWeightMale && (
                    <span className="text-xs text-muted-foreground">
                      ({m.prescribedWeightMale}
                      {m.prescribedWeightFemale
                        ? `/${m.prescribedWeightFemale}`
                        : ""}{" "}
                      lb)
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="sb-title">Title</Label>
            <Input
              id="sb-title"
              value={form.title}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, title: e.target.value }))
              }
              placeholder={autoTitle}
            />
          </div>

          {/* Date */}
          <div className="space-y-2">
            <Label htmlFor="sb-date">Date</Label>
            <Input
              id="sb-date"
              type="date"
              value={form.workoutDate}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, workoutDate: e.target.value }))
              }
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button type="button" onClick={handleSubmit} className="flex-1">
              <Save className="size-4" />
              Save Workout
            </Button>
            {onCancel && (
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
