"use client";

import { useState, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowRight, Save } from "lucide-react";
import {
  MultiPartConfig,
  emptyPart,
} from "@/components/crossfit/multi-part-config";
import { PartnerWorkoutToggle } from "@/components/crossfit/partner-workout-toggle";
import { builderPartToPayload } from "@/lib/crossfit/builder-payload";
import type {
  WorkoutBuilderPart,
  WorkoutBuilderMovement,
} from "@/types/crossfit";
import { WORKOUT_TYPE_LABELS, WORKOUT_TYPE_COLORS } from "@/types/crossfit";
import type { CreatePartInput } from "@/hooks/useWorkouts";

// Multi-part payload shape sent to the benchmark API. Mirrors
// CreateWorkoutInput's `parts` shape so the two callers (workout / benchmark)
// can't drift apart on which part fields the server accepts.
export interface BenchmarkFormData {
  name: string;
  description: string;
  isPartner?: boolean;
  partnerCount?: number;
  parts: CreatePartInput[];
}

interface BenchmarkFormProps {
  onSave: (data: BenchmarkFormData) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

type Step = "build" | "review";

// See smart-builder.tsx for the same disambiguator used there. Kept in
// sync manually since both review screens render the same shape.
function formatGenderedScheme(
  male: string | undefined,
  female: string | undefined,
  unit: string
): string {
  const m = male?.trim() || "";
  const f = female?.trim() || "";
  const hasM = !!m;
  const hasF = !!f;
  if (!hasM && !hasF) return "";
  if (hasM && !hasF) return `${m} ${unit}`;
  if (!hasM && hasF) return `${f} ${unit}`;
  if (m === f) return `${m} ${unit}`;
  if (m.includes("-") || f.includes("-")) {
    return `${m} ${unit} (M) / ${f} ${unit} (F)`;
  }
  return `${m}/${f} ${unit}`;
}

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
    return formatGenderedScheme(
      m.prescribedCaloriesMale,
      m.prescribedCaloriesFemale,
      "cal"
    );
  }
  if (m.metricType === "distance") {
    if (!m.prescribedDistanceMale && !m.prescribedDistanceFemale) return null;
    return formatGenderedScheme(
      m.prescribedDistanceMale,
      m.prescribedDistanceFemale,
      "m"
    );
  }
  return null;
}

// Movement key for a builder movement's block membership. Newly-added blocks
// reference by `blockTempRef`; round-tripped blocks (when editing) reference
// by `blockId`. The block itself is identified by its tempId — we look up
// blocks by tempId and (for round-tripped blocks) also by id.
function builderMovementBlockKey(
  m: WorkoutBuilderMovement
): string | null {
  return m.blockTempRef ?? m.blockId ?? null;
}

function BuilderMovementBlocks({ part }: { part: WorkoutBuilderPart }) {
  const blocks = part.blocks ?? [];
  const orderedBlocks = [...blocks].sort(
    (a, b) => a.orderIndex - b.orderIndex
  );

  // A movement matches a block when its blockTempRef === block.tempId
  // (newly-added) or its blockId === block.id (round-tripped).
  const movementsByBlockTempId = new Map<string, WorkoutBuilderMovement[]>();
  const ungrouped: WorkoutBuilderMovement[] = [];
  for (const m of part.movements) {
    const key = builderMovementBlockKey(m);
    if (!key) {
      ungrouped.push(m);
      continue;
    }
    const block = blocks.find((b) => b.tempId === key || b.id === key);
    if (!block) {
      ungrouped.push(m);
      continue;
    }
    const list = movementsByBlockTempId.get(block.tempId) ?? [];
    list.push(m);
    movementsByBlockTempId.set(block.tempId, list);
  }

  return (
    <div className="space-y-2">
      {ungrouped.length > 0 && (
        <BuilderMovementList movements={ungrouped} />
      )}
      {orderedBlocks.map((b) => {
        const blockMovements = movementsByBlockTempId.get(b.tempId) ?? [];
        if (blockMovements.length === 0) return null;
        return (
          <div key={b.tempId} className="space-y-1">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {b.title}
            </h4>
            <BuilderMovementList movements={blockMovements} />
          </div>
        );
      })}
    </div>
  );
}

function BuilderMovementList({
  movements,
}: {
  movements: WorkoutBuilderMovement[];
}) {
  return (
    <div className="space-y-1">
      {movements.map((m, i) => {
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
              <span className="text-xs text-muted-foreground">({metric})</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function BenchmarkForm({
  onSave,
  onCancel,
  isLoading,
}: BenchmarkFormProps) {
  const [step, setStep] = useState<Step>("build");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPartner, setIsPartner] = useState(false);
  const [partnerCount, setPartnerCount] = useState("");
  const [parts, setParts] = useState<WorkoutBuilderPart[]>(() => [emptyPart()]);

  const handlePartsChange = useCallback((next: WorkoutBuilderPart[]) => {
    setParts(next);
  }, []);

  const canReview = useMemo(
    () =>
      name.trim().length > 0 &&
      parts.length > 0 &&
      parts.every((p) => p.movements.some((m) => m.movementId)),
    [name, parts]
  );

  const handleSubmit = useCallback(() => {
    const partsPayload = parts
      .map(builderPartToPayload)
      .filter((p): p is CreatePartInput => p !== null);
    if (partsPayload.length === 0) return;
    onSave({
      name: name.trim(),
      description,
      isPartner,
      partnerCount:
        isPartner && partnerCount ? parseInt(partnerCount, 10) : undefined,
      parts: partsPayload,
    });
  }, [name, description, parts, isPartner, partnerCount, onSave]);

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

          <MultiPartConfig
            parts={parts}
            onPartsChange={handlePartsChange}
            showRepScheme
          />

          <PartnerWorkoutToggle
            isPartner={isPartner}
            partnerCount={partnerCount}
            onChange={(updates) => {
              if (updates.isPartner !== undefined) setIsPartner(updates.isPartner);
              if (updates.partnerCount !== undefined)
                setPartnerCount(updates.partnerCount);
            }}
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

          <div className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-lg font-bold">{name}</p>
              {isPartner && (
                <Badge variant="outline" className="text-[10px]">
                  Partner
                </Badge>
              )}
            </div>

            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}

            {parts.map((part, idx) => (
              <div
                key={part.tempId}
                className="rounded-md border border-border/40 bg-background/30 p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={WORKOUT_TYPE_COLORS[part.workoutType]}
                    >
                      {part.label || `Part ${String.fromCharCode(65 + idx)}`}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {WORKOUT_TYPE_LABELS[part.workoutType]}
                    </span>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground">
                  {part.workoutType === "for_time" && part.rounds
                    ? `${part.rounds} rounds`
                    : ""}
                  {part.repScheme ? ` · ${part.repScheme}` : ""}
                  {part.workoutType === "amrap" && part.amrapDurationInput
                    ? ` · ${part.amrapDurationInput}`
                    : ""}
                  {(part.workoutType === "for_time" ||
                    part.workoutType === "emom" ||
                    part.workoutType === "for_reps") &&
                  part.timeCapInput
                    ? ` · ${part.timeCapInput} cap`
                    : ""}
                </div>

                <Separator />

                <BuilderMovementBlocks part={part} />
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
