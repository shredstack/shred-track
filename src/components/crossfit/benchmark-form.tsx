"use client";

import { useState, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, ArrowRight, Save } from "lucide-react";
import { WorkoutTypeSelector } from "@/components/crossfit/workout-type-selector";
import { MovementListBuilder } from "@/components/crossfit/movement-list-builder";
import type { WorkoutType, WorkoutBuilderMovement } from "@/types/crossfit";

interface BenchmarkFormData {
  name: string;
  description: string;
  workoutType: WorkoutType;
  timeCapSeconds?: number;
  amrapDurationSeconds?: number;
  repScheme: string;
  movements: {
    movementId: string;
    orderIndex: number;
    prescribedReps?: string;
    prescribedWeightMale?: number;
    prescribedWeightFemale?: number;
    rxStandard?: string;
  }[];
}

interface BenchmarkFormProps {
  onSave: (data: BenchmarkFormData) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

type Step = "name" | "type" | "config" | "movements" | "review";

const STEPS: Step[] = ["name", "type", "config", "movements", "review"];

export function BenchmarkForm({
  onSave,
  onCancel,
  isLoading,
}: BenchmarkFormProps) {
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [workoutType, setWorkoutType] = useState<WorkoutType>("for_time");
  const [timeCapMinutes, setTimeCapMinutes] = useState("");
  const [amrapDurationMinutes, setAmrapDurationMinutes] = useState("");
  const [repScheme, setRepScheme] = useState("");
  const [movements, setMovements] = useState<WorkoutBuilderMovement[]>([]);

  const stepIndex = STEPS.indexOf(step);

  const goBack = useCallback(() => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  }, [step]);

  const goNext = useCallback(() => {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  }, [step]);

  const handleSubmit = useCallback(() => {
    const data: BenchmarkFormData = {
      name: name.trim(),
      description,
      workoutType,
      timeCapSeconds: timeCapMinutes ? parseInt(timeCapMinutes) * 60 : undefined,
      amrapDurationSeconds: amrapDurationMinutes
        ? parseInt(amrapDurationMinutes) * 60
        : undefined,
      repScheme,
      movements: movements
        .filter((m) => m.movementId)
        .map((m, i) => ({
          movementId: m.movementId!,
          orderIndex: i,
          prescribedReps: m.prescribedReps || undefined,
          prescribedWeightMale: m.prescribedWeightMale
            ? Number(m.prescribedWeightMale)
            : undefined,
          prescribedWeightFemale: m.prescribedWeightFemale
            ? Number(m.prescribedWeightFemale)
            : undefined,
          rxStandard: m.rxStandard || undefined,
        })),
    };
    onSave(data);
  }, [
    name,
    description,
    workoutType,
    timeCapMinutes,
    amrapDurationMinutes,
    repScheme,
    movements,
    onSave,
  ]);

  return (
    <div className="space-y-4">
      {/* Step 1: Name */}
      {step === "name" && (
        <div className="space-y-4">
          <h3 className="font-semibold">Create New Benchmark</h3>
          <div className="space-y-2">
            <Label htmlFor="bf-name">Benchmark Name</Label>
            <Input
              id="bf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. The Sarah, Gym WOD #1"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bf-desc">Description (optional)</Label>
            <Textarea
              id="bf-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Origin story, notes, etc."
              rows={2}
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={goNext}
              className="flex-1"
              disabled={!name.trim()}
            >
              Next
              <ArrowRight className="size-4" />
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Workout Type */}
      {step === "type" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={goBack}
            >
              <ArrowLeft className="size-4" />
            </Button>
            <h3 className="font-semibold">Workout Type</h3>
          </div>
          <WorkoutTypeSelector
            value={workoutType}
            onSelect={(type) => {
              setWorkoutType(type);
              goNext();
            }}
          />
        </div>
      )}

      {/* Step 3: Config */}
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
          </div>

          {(workoutType === "for_time" || workoutType === "emom") && (
            <div className="space-y-2">
              <Label>
                {workoutType === "emom" ? "Duration (min)" : "Time Cap (min)"}
              </Label>
              <Input
                type="number"
                min={0}
                value={timeCapMinutes}
                onChange={(e) => setTimeCapMinutes(e.target.value)}
                placeholder="Optional"
              />
            </div>
          )}

          {workoutType === "amrap" && (
            <div className="space-y-2">
              <Label>AMRAP Duration (min)</Label>
              <Input
                type="number"
                min={1}
                value={amrapDurationMinutes}
                onChange={(e) => setAmrapDurationMinutes(e.target.value)}
                placeholder="e.g. 12"
              />
            </div>
          )}

          {(workoutType === "for_time" ||
            workoutType === "for_load" ||
            workoutType === "amrap") && (
            <div className="space-y-2">
              <Label>Rep Scheme</Label>
              <Input
                value={repScheme}
                onChange={(e) => setRepScheme(e.target.value)}
                placeholder="e.g. 21-15-9 or 5 rounds"
              />
            </div>
          )}

          <Button type="button" onClick={goNext} className="w-full">
            Next
            <ArrowRight className="size-4" />
          </Button>
        </div>
      )}

      {/* Step 4: Movements */}
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
            <h3 className="font-semibold">Movements</h3>
          </div>

          <MovementListBuilder
            movements={movements}
            onChange={setMovements}
          />

          <Button
            type="button"
            onClick={goNext}
            className="w-full"
            disabled={movements.length === 0}
          >
            Review
            <ArrowRight className="size-4" />
          </Button>
        </div>
      )}

      {/* Step 5: Review */}
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
            <h3 className="font-semibold">Review Benchmark</h3>
          </div>

          <div className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-2">
            <p className="text-lg font-bold">{name}</p>
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
            {repScheme && <p className="text-sm">{repScheme}</p>}

            <Separator />

            {movements.map((m, i) => (
              <div
                key={m.tempId}
                className="flex items-center gap-2 text-sm"
              >
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

          <div className="flex gap-2">
            <Button
              type="button"
              onClick={handleSubmit}
              className="flex-1"
              disabled={isLoading}
            >
              <Save className="size-4" />
              {isLoading ? "Saving..." : "Save Benchmark"}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
