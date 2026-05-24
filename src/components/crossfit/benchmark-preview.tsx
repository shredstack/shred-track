"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Plus } from "lucide-react";
import { useState } from "react";
import type {
  BenchmarkMovement,
  BenchmarkWorkout,
  BenchmarkWorkoutBlock,
} from "@/types/crossfit";
import { WORKOUT_TYPE_LABELS, WORKOUT_TYPE_COLORS } from "@/types/crossfit";
import {
  WorkoutDateInput,
  localTodayString,
} from "@/components/crossfit/workout-date-input";
import { PartnerWorkoutToggle } from "@/components/crossfit/partner-workout-toggle";

// Renders a part's movements grouped by their optional block titles. When a
// part has no blocks (or every movement is ungrouped), this falls back to
// the flat numbered list — matches the legacy single-part rendering.
function PartMovementList({
  blocks,
  movements,
}: {
  blocks: BenchmarkWorkoutBlock[];
  movements: BenchmarkMovement[];
}) {
  const ungrouped = movements.filter((m) => !m.blockId);
  const movementsByBlock = new Map<string, BenchmarkMovement[]>();
  for (const m of movements) {
    if (!m.blockId) continue;
    const list = movementsByBlock.get(m.blockId) ?? [];
    list.push(m);
    movementsByBlock.set(m.blockId, list);
  }
  const orderedBlocks = [...blocks].sort((a, b) => a.orderIndex - b.orderIndex);

  return (
    <div className="space-y-3">
      {ungrouped.length > 0 && <MovementList movements={ungrouped} />}
      {orderedBlocks.map((b) => {
        const blockMovements = movementsByBlock.get(b.id) ?? [];
        if (blockMovements.length === 0) return null;
        return (
          <div key={b.id} className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {b.title}
            </h4>
            <MovementList movements={blockMovements} />
          </div>
        );
      })}
    </div>
  );
}

function MovementList({ movements }: { movements: BenchmarkMovement[] }) {
  return (
    <div className="space-y-1.5">
      {movements.map((m, i) => (
        <div key={m.id} className="flex items-baseline gap-2 text-sm">
          <span className="text-xs text-muted-foreground w-4 text-right">
            {i + 1}.
          </span>
          <span className="font-medium">{m.movementName}</span>
          {m.prescribedReps && (
            <span className="text-muted-foreground">{m.prescribedReps}</span>
          )}
          {(m.prescribedWeightMale || m.prescribedWeightFemale) && (
            <span className="text-xs text-muted-foreground">
              ({m.prescribedWeightMale}
              {m.prescribedWeightFemale
                ? `/${m.prescribedWeightFemale}`
                : ""}{" "}
              lb)
            </span>
          )}
          {m.rxStandard && (
            <span className="text-xs italic text-muted-foreground">
              {m.rxStandard}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

interface BenchmarkPreviewProps {
  benchmark: BenchmarkWorkout;
  onAdd: (
    benchmarkId: string,
    workoutDate: string,
    options: { isPartner: boolean; partnerCount: number | null }
  ) => void;
  onBack: () => void;
  isLoading?: boolean;
  defaultWorkoutDate?: string;
  // Label for the primary action button (default "Add Workout").
  submitLabel?: string;
  // Hide the date input — used when the parent fixes the date (e.g.
  // programming a section for a specific day).
  hideDateInput?: boolean;
  // Hide the partner toggle — used when partner/solo is decided by the
  // athlete at scoring time, not when programming the workout.
  hidePartner?: boolean;
}

export function BenchmarkPreview({
  benchmark,
  onAdd,
  onBack,
  isLoading,
  defaultWorkoutDate,
  submitLabel,
  hideDateInput,
  hidePartner,
}: BenchmarkPreviewProps) {
  const [workoutDate, setWorkoutDate] = useState(
    defaultWorkoutDate || localTodayString()
  );
  // Default to the benchmark's own partner flag — most users picking a
  // benchmark want it as-is. They can flip a non-partner benchmark on
  // (e.g. doing Murph as a pair) or vice versa before adding.
  const [isPartner, setIsPartner] = useState(!!benchmark.isPartner);
  const [partnerCount, setPartnerCount] = useState(
    benchmark.partnerCount != null ? String(benchmark.partnerCount) : ""
  );

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        &larr; Back to benchmarks
      </button>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-bold">{benchmark.name}</h3>
          {benchmark.parts.length === 1 && (
            <Badge
              variant="outline"
              className={WORKOUT_TYPE_COLORS[benchmark.workoutType]}
            >
              {WORKOUT_TYPE_LABELS[benchmark.workoutType]}
            </Badge>
          )}
        </div>

        {benchmark.description && (
          <p className="text-sm text-muted-foreground">
            {benchmark.description}
          </p>
        )}
      </div>

      <Separator />

      {/* Per-part breakdown. Single-part benchmarks render flat, multi-part
          benchmarks show one card per part with its own type badge. */}
      <div className="space-y-3">
        {benchmark.parts.map((part, idx) => {
          const showPartHeader = benchmark.parts.length > 1;
          const partLabel =
            part.label || `Part ${String.fromCharCode(65 + idx)}`;
          return (
            <div
              key={part.id}
              className={
                showPartHeader
                  ? "rounded-md border border-border/40 bg-muted/20 p-3 space-y-2"
                  : "space-y-2"
              }
            >
              {showPartHeader && (
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={WORKOUT_TYPE_COLORS[part.workoutType]}
                  >
                    {partLabel}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {WORKOUT_TYPE_LABELS[part.workoutType]}
                  </span>
                </div>
              )}

              {part.repScheme && (
                <p className="text-sm font-medium">{part.repScheme}</p>
              )}
              {part.rounds && (
                <p className="text-xs text-muted-foreground">
                  {part.rounds} rounds
                </p>
              )}
              {part.timeCapSeconds && (
                <p className="text-xs text-muted-foreground">
                  Time cap: {Math.floor(part.timeCapSeconds / 60)} min
                </p>
              )}
              {part.amrapDurationSeconds && (
                <p className="text-xs text-muted-foreground">
                  Duration: {Math.floor(part.amrapDurationSeconds / 60)} min
                </p>
              )}

              <PartMovementList
                blocks={part.blocks}
                movements={part.movements}
              />
            </div>
          );
        })}
      </div>

      <Separator />

      {/* Date picker + partner override + Add button */}
      <div className="space-y-3">
        {!hideDateInput && (
          <WorkoutDateInput
            id="bp-date"
            value={workoutDate}
            onChange={setWorkoutDate}
          />
        )}

        {!hidePartner && (
          <PartnerWorkoutToggle
            isPartner={isPartner}
            partnerCount={partnerCount}
            onChange={(updates) => {
              if (updates.isPartner !== undefined) setIsPartner(updates.isPartner);
              if (updates.partnerCount !== undefined)
                setPartnerCount(updates.partnerCount);
            }}
          />
        )}

        <Button
          className="w-full"
          onClick={() =>
            onAdd(benchmark.id, workoutDate, {
              isPartner: hidePartner ? false : isPartner,
              partnerCount:
                !hidePartner && isPartner && partnerCount
                  ? parseInt(partnerCount, 10)
                  : null,
            })
          }
          disabled={isLoading}
        >
          <Plus className="size-4" />
          {isLoading ? "Adding..." : submitLabel ?? "Add Workout"}
        </Button>
      </div>
    </div>
  );
}
