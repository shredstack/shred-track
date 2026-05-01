"use client";

import { useState, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowRight, Save } from "lucide-react";
import { WorkoutPartConfig } from "@/components/crossfit/workout-part-config";
import type {
  WorkoutType,
  WorkoutBuilderPart,
  WorkoutBuilderMovement,
} from "@/types/crossfit";
import { WORKOUT_TYPE_LABELS, WORKOUT_TYPE_COLORS } from "@/types/crossfit";

// Payload shape kept stable so existing callers (BenchmarkPicker →
// useCreateBenchmark) continue to work unchanged.
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

type Step = "build" | "review";

function generateId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyPart(): WorkoutBuilderPart {
  return {
    tempId: generateId("part"),
    label: "",
    workoutType: "for_time",
    timeCapMinutes: "",
    amrapDurationMinutes: "",
    emomIntervalSeconds: "",
    intervalWorkSeconds: "",
    intervalRestSeconds: "",
    repScheme: "",
    rounds: "",
    movements: [],
  };
}

// Single-line metric summary for the review screen, matching the Smart
// Builder formatting so the review feels consistent across surfaces.
function formatMovementMetric(m: WorkoutBuilderMovement): string | null {
  const prefix =
    m.equipmentCount && m.equipmentCount > 1 ? `${m.equipmentCount} × ` : "";
  if (m.metricType === "weight") {
    if (!m.prescribedWeightMale && !m.prescribedWeightFemale) return null;
    return `${prefix}${m.prescribedWeightMale || "?"}${
      m.prescribedWeightFemale ? `/${m.prescribedWeightFemale}` : ""
    } lb`;
  }
  if (m.metricType === "calories") {
    if (!m.prescribedCaloriesMale && !m.prescribedCaloriesFemale) return null;
    return `${m.prescribedCaloriesMale || "?"}${
      m.prescribedCaloriesFemale ? `/${m.prescribedCaloriesFemale}` : ""
    } cal`;
  }
  if (m.metricType === "distance") {
    if (!m.prescribedDistanceMale && !m.prescribedDistanceFemale) return null;
    return `${m.prescribedDistanceMale || "?"}${
      m.prescribedDistanceFemale ? `/${m.prescribedDistanceFemale}` : ""
    } m`;
  }
  return null;
}

export function BenchmarkForm({
  onSave,
  onCancel,
  isLoading,
}: BenchmarkFormProps) {
  const [step, setStep] = useState<Step>("build");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [part, setPart] = useState<WorkoutBuilderPart>(() => emptyPart());

  const updatePart = useCallback((updates: Partial<WorkoutBuilderPart>) => {
    setPart((prev) => ({ ...prev, ...updates }));
  }, []);

  const updateMovements = useCallback(
    (movements: WorkoutBuilderMovement[]) => {
      setPart((prev) => ({ ...prev, movements }));
    },
    []
  );

  const canReview = useMemo(
    () =>
      name.trim().length > 0 && part.movements.some((m) => m.movementId),
    [name, part.movements]
  );

  const handleSubmit = useCallback(() => {
    onSave({
      name: name.trim(),
      description,
      workoutType: part.workoutType,
      timeCapSeconds: part.timeCapMinutes
        ? parseInt(part.timeCapMinutes, 10) * 60
        : undefined,
      amrapDurationSeconds: part.amrapDurationMinutes
        ? parseInt(part.amrapDurationMinutes, 10) * 60
        : undefined,
      repScheme: part.repScheme,
      movements: part.movements
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
    });
  }, [name, description, part, onSave]);

  return (
    <div className="space-y-4">
      {/* Progress indicator — mirrors SmartBuilder so the UX feels familiar */}
      <div className="flex items-center gap-1">
        <div
          className={`flex size-6 items-center justify-center rounded-full text-xs font-medium ${
            step === "build"
              ? "bg-primary/20 text-primary ring-1 ring-primary/50"
              : "bg-primary text-primary-foreground"
          }`}
        >
          1
        </div>
        <div
          className={`h-px w-6 ${step === "review" ? "bg-primary" : "bg-border"}`}
        />
        <div
          className={`flex size-6 items-center justify-center rounded-full text-xs font-medium ${
            step === "review"
              ? "bg-primary/20 text-primary ring-1 ring-primary/50"
              : "bg-muted/50 text-muted-foreground"
          }`}
        >
          2
        </div>
      </div>

      {step === "build" && (
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

          <Separator />

          <WorkoutPartConfig
            part={part}
            onChange={updatePart}
            onMovementsChange={updateMovements}
            showRepScheme
          />

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              onClick={() => setStep("review")}
              className="flex-1"
              disabled={!canReview}
            >
              Review
              <ArrowRight className="size-4" />
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setStep("build")}
            >
              <ArrowLeft className="size-4" />
            </Button>
            <h3 className="font-semibold">Review Benchmark</h3>
          </div>

          <div className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-lg font-bold">{name}</p>
              <Badge
                variant="outline"
                className={WORKOUT_TYPE_COLORS[part.workoutType]}
              >
                {WORKOUT_TYPE_LABELS[part.workoutType]}
              </Badge>
            </div>

            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}

            {/* Configuration summary */}
            <div className="text-xs text-muted-foreground">
              {part.workoutType === "for_time" && part.rounds
                ? `${part.rounds} rounds`
                : ""}
              {part.repScheme ? ` · ${part.repScheme}` : ""}
              {part.workoutType === "amrap" && part.amrapDurationMinutes
                ? ` · ${part.amrapDurationMinutes} min`
                : ""}
              {(part.workoutType === "for_time" ||
                part.workoutType === "emom" ||
                part.workoutType === "for_reps") &&
              part.timeCapMinutes
                ? ` · ${part.timeCapMinutes} min cap`
                : ""}
            </div>

            <Separator />

            {part.movements.map((m, i) => {
              const metric = formatMovementMetric(m);
              return (
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
                  {metric && (
                    <span className="text-xs text-muted-foreground">
                      ({metric})
                    </span>
                  )}
                </div>
              );
            })}
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
