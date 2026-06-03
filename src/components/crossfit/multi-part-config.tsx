"use client";

import { useCallback, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { WorkoutPartConfig } from "@/components/crossfit/workout-part-config";
import type { EarlierLoadPart } from "@/components/crossfit/movement-list-builder";
import type {
  WorkoutBuilderBlock,
  WorkoutBuilderPart,
  WorkoutBuilderMovement,
} from "@/types/crossfit";
import { WORKOUT_TYPE_LABELS, WORKOUT_TYPE_COLORS } from "@/types/crossfit";

// ============================================
// Shared multi-part chrome
// ============================================
//
// Renders an ordered list of WorkoutBuilderPart cards with controls to
// reorder, collapse, add, and delete parts. Each card delegates the
// type-specific fields to WorkoutPartConfig.
//
// Used by:
//   - SmartBuilder (build step)
//   - BenchmarkForm (user-facing custom benchmarks)
//   - AdminBenchmarks (admin / system benchmarks)
//
// The component is fully controlled — the parent owns `parts` and is
// notified of changes via `onPartsChange(nextParts)`. Collapsed state is
// internal because it's purely chrome and never round-trips to the server.

const DEFAULT_MAX_PARTS = 6;

export function generatePartId() {
  return `part-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyPart(): WorkoutBuilderPart {
  return {
    tempId: generatePartId(),
    label: "",
    workoutType: "for_time",
    timeCapInput: "",
    amrapDurationInput: "",
    emomIntervalInput: "",
    intervalWorkInput: "",
    intervalRestInput: "",
    repScheme: "",
    rounds: "",
    movements: [],
    blocks: [],
  };
}

function partSummary(part: WorkoutBuilderPart, idx: number): string {
  const segments: string[] = [];
  segments.push(part.label || `Part ${String.fromCharCode(65 + idx)}`);
  segments.push(WORKOUT_TYPE_LABELS[part.workoutType]);
  if (part.workoutType === "for_time" && part.rounds)
    segments.push(`${part.rounds} rds`);
  if (part.workoutType === "for_reps" && part.structure === "tabata")
    segments.push("Tabata");
  if (part.workoutType === "intervals") {
    if (part.rounds) segments.push(`${part.rounds} rds`);
    if (part.intervalWorkInput && part.intervalRestInput) {
      segments.push(
        `${part.intervalWorkInput} work / ${part.intervalRestInput} rest`
      );
    }
  }
  if (part.workoutType === "timed_rounds") {
    if (part.roundWindowInput?.trim() && part.rounds) {
      segments.push(`Every ${part.roundWindowInput} × ${part.rounds}`);
    } else if (part.rounds) {
      segments.push(`${part.rounds} timed rounds`);
    }
    const agg = part.roundScoreAggregation ?? "slowest";
    segments.push(
      agg === "slowest"
        ? "Slowest"
        : agg === "fastest"
          ? "Fastest"
          : agg === "sum"
            ? "Sum"
            : "Avg"
    );
  }
  if (part.repScheme) segments.push(part.repScheme);
  if (part.workoutType === "amrap" && part.amrapDurationInput)
    segments.push(part.amrapDurationInput);
  if (
    (part.workoutType === "for_time" ||
      part.workoutType === "emom" ||
      part.workoutType === "for_reps") &&
    part.timeCapInput
  )
    segments.push(part.timeCapInput);
  const movs = part.movements
    .slice(0, 2)
    .map((m) => m.movementName)
    .filter(Boolean)
    .join(", ");
  if (movs) segments.push(movs);
  return segments.join(" · ");
}

interface PartCardProps {
  part: WorkoutBuilderPart;
  index: number;
  totalParts: number;
  isCollapsed: boolean;
  showRepScheme: boolean;
  earlierLoadParts: EarlierLoadPart[];
  onToggleCollapse: () => void;
  onChange: (updates: Partial<WorkoutBuilderPart>) => void;
  onMovementsChange: (movements: WorkoutBuilderMovement[]) => void;
  onBlocksChange: (blocks: WorkoutBuilderBlock[]) => void;
  onMove: (direction: "up" | "down") => void;
  onDelete: () => void;
}

function PartCard({
  part,
  index,
  totalParts,
  isCollapsed,
  showRepScheme,
  earlierLoadParts,
  onToggleCollapse,
  onChange,
  onMovementsChange,
  onBlocksChange,
  onMove,
  onDelete,
}: PartCardProps) {
  const defaultLabel = `Part ${String.fromCharCode(65 + index)}`;
  // For single-part workouts, the "Part A" wrapper is noise — blocks are
  // the primary grouping. Render the part body directly without the
  // collapsible card chrome.
  const isSingleton = totalParts === 1;

  if (isSingleton) {
    return (
      <WorkoutPartConfig
        part={part}
        onChange={onChange}
        onMovementsChange={onMovementsChange}
        onBlocksChange={onBlocksChange}
        showRepScheme={showRepScheme}
        earlierLoadParts={earlierLoadParts}
        compact
      />
    );
  }

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex flex-1 items-center gap-2 text-left min-w-0"
          onClick={onToggleCollapse}
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? "Expand part" : "Collapse part"}
        >
          <ChevronRight
            className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${
              isCollapsed ? "" : "rotate-90"
            }`}
          />
          <Badge
            variant="outline"
            className={WORKOUT_TYPE_COLORS[part.workoutType]}
          >
            {part.label || defaultLabel}
          </Badge>
          {isCollapsed && (
            // min-w-0 + flex-1: a flex child keeps its full intrinsic width
            // otherwise, so `truncate` would never kick in and the long
            // summary string would force the card (and dialog) to overflow.
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {partSummary(part, index)}
            </span>
          )}
        </button>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => onMove("up")}
            disabled={index === 0}
          >
            <ChevronUp className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => onMove("down")}
            disabled={index === totalParts - 1}
          >
            <ChevronDown className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onDelete}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="space-y-3 pt-1">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Label (optional)
            </Label>
            <Input
              value={part.label}
              onChange={(e) => onChange({ label: e.target.value })}
              placeholder={`e.g. Strength, ${defaultLabel}`}
              className="h-8 text-xs"
            />
          </div>

          <WorkoutPartConfig
            part={part}
            onChange={onChange}
            onMovementsChange={onMovementsChange}
            onBlocksChange={onBlocksChange}
            showRepScheme={showRepScheme}
            earlierLoadParts={earlierLoadParts}
            compact
          />
        </div>
      )}
    </div>
  );
}

export interface MultiPartConfigProps {
  parts: WorkoutBuilderPart[];
  onPartsChange: (parts: WorkoutBuilderPart[]) => void;
  /** Maximum number of parts. Defaults to 6. */
  maxParts?: number;
  /** Forwarded to each part's WorkoutPartConfig. Defaults to false. */
  showRepScheme?: boolean;
  /** Label for the "add another part" button. */
  addButtonLabel?: string;
  /**
   * Opt-in: surface the "% of earlier part" weight mode in the builder. A
   * movement in a later part can then be prescribed as a percentage of the
   * max load logged on an earlier for_load part. Off by default so the
   * benchmark forms (which reuse this component) are unaffected.
   */
  enableWeightPct?: boolean;
}

export function MultiPartConfig({
  parts,
  onPartsChange,
  maxParts = DEFAULT_MAX_PARTS,
  showRepScheme = false,
  addButtonLabel = "Add another part",
  enableWeightPct = false,
}: MultiPartConfigProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  // For each part, the for_load parts that come before it — the candidates
  // a weight_pct prescription can anchor to. Keyed by part tempId. Empty
  // when `enableWeightPct` is off.
  const earlierLoadPartsByTempId = useMemo(() => {
    const map = new Map<string, EarlierLoadPart[]>();
    if (!enableWeightPct) return map;
    const accumulated: EarlierLoadPart[] = [];
    parts.forEach((p, idx) => {
      map.set(p.tempId, [...accumulated]);
      if (p.workoutType === "for_load") {
        accumulated.push({
          tempId: p.tempId,
          label: p.label?.trim() || `Part ${String.fromCharCode(65 + idx)}`,
        });
      }
    });
    return map;
  }, [parts, enableWeightPct]);

  const updatePart = useCallback(
    (tempId: string, updates: Partial<WorkoutBuilderPart>) => {
      onPartsChange(
        parts.map((p) => (p.tempId === tempId ? { ...p, ...updates } : p))
      );
    },
    [parts, onPartsChange]
  );

  const updatePartMovements = useCallback(
    (tempId: string, movements: WorkoutBuilderMovement[]) => {
      onPartsChange(
        parts.map((p) => (p.tempId === tempId ? { ...p, movements } : p))
      );
    },
    [parts, onPartsChange]
  );

  const updatePartBlocks = useCallback(
    (tempId: string, blocks: WorkoutBuilderBlock[]) => {
      onPartsChange(
        parts.map((p) => (p.tempId === tempId ? { ...p, blocks } : p))
      );
    },
    [parts, onPartsChange]
  );

  const addPart = useCallback(() => {
    if (parts.length >= maxParts) return;
    const newPart = emptyPart();
    setCollapsed(new Set(parts.map((p) => p.tempId)));
    onPartsChange([...parts, newPart]);
  }, [parts, maxParts, onPartsChange]);

  const deletePart = useCallback(
    (tempId: string) => {
      if (parts.length <= 1) return;
      onPartsChange(parts.filter((p) => p.tempId !== tempId));
    },
    [parts, onPartsChange]
  );

  const movePart = useCallback(
    (tempId: string, direction: "up" | "down") => {
      const idx = parts.findIndex((p) => p.tempId === tempId);
      if (idx === -1) return;
      const swap = direction === "up" ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= parts.length) return;
      const next = [...parts];
      [next[idx], next[swap]] = [next[swap], next[idx]];
      onPartsChange(next);
    },
    [parts, onPartsChange]
  );

  const toggleCollapse = useCallback((tempId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(tempId)) next.delete(tempId);
      else next.add(tempId);
      return next;
    });
  }, []);

  return (
    <div className="space-y-3">
      {parts.map((part, idx) => (
        <PartCard
          key={part.tempId}
          part={part}
          index={idx}
          totalParts={parts.length}
          isCollapsed={collapsed.has(part.tempId)}
          showRepScheme={showRepScheme}
          earlierLoadParts={earlierLoadPartsByTempId.get(part.tempId) ?? []}
          onToggleCollapse={() => toggleCollapse(part.tempId)}
          onChange={(updates) => updatePart(part.tempId, updates)}
          onMovementsChange={(movements) =>
            updatePartMovements(part.tempId, movements)
          }
          onBlocksChange={(blocks) => updatePartBlocks(part.tempId, blocks)}
          onMove={(direction) => movePart(part.tempId, direction)}
          onDelete={() => deletePart(part.tempId)}
        />
      ))}

      {parts.length < maxParts && (
        <Button
          type="button"
          variant="outline"
          className="w-full border-dashed"
          onClick={addPart}
        >
          <Plus className="size-4" />
          {addButtonLabel}
        </Button>
      )}
    </div>
  );
}
