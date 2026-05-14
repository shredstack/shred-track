"use client";

import React, { useCallback } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  X,
  Footprints,
  Dumbbell,
  ArrowRightLeft,
  RotateCcw,
} from "lucide-react";
import {
  DIVISIONS,
  parseDistanceToMeters,
  STATION_PACE_TYPE,
  type DivisionKey,
} from "@/lib/hyrox-data";
import type { RaceSegment } from "./types";

// ---------------------------------------------------------------------------
// Canonical-station lookup + modified detection
// ---------------------------------------------------------------------------

function getCanonicalStation(divisionKey: DivisionKey | undefined, name: string) {
  if (!divisionKey) return null;
  return DIVISIONS[divisionKey]?.stations.find((s) => s.name === name) ?? null;
}

function isSegmentModified(
  segment: RaceSegment,
  divisionKey: DivisionKey | undefined,
): boolean {
  if (segment.segmentType === "run") {
    // Roxzone has a fixed 100m baseline; prescribed runs use the
    // division's runDistanceM. Only flag when the numeric distance
    // differs from the corresponding baseline.
    if (!divisionKey) return false;
    const div = DIVISIONS[divisionKey];
    if (!div) return false;
    const expected =
      segment.segmentSubtype === "roxzone" ? 100 : div.runDistanceM;
    const actual =
      segment.distanceMeters ?? parseDistanceToMeters(segment.distance);
    if (actual == null) return false;
    return actual !== expected;
  }
  const canonical = getCanonicalStation(divisionKey, segment.label);
  if (!canonical) return false;
  const canonicalDistance = parseDistanceToMeters(canonical.distance);
  const currentDistance =
    segment.distanceMeters ?? parseDistanceToMeters(segment.distance);
  if (
    canonicalDistance != null &&
    currentDistance != null &&
    canonicalDistance !== currentDistance
  ) {
    return true;
  }
  if (canonical.reps != null && segment.reps != null && canonical.reps !== segment.reps) {
    return true;
  }
  if (
    canonical.weightKg != null &&
    segment.weightKg != null &&
    canonical.weightKg !== segment.weightKg
  ) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Sortable segment item
// ---------------------------------------------------------------------------

interface SortableSegmentItemProps {
  segment: RaceSegment;
  index: number;
  editable: boolean;
  divisionKey?: DivisionKey;
  onRemove: (id: string) => void;
  onPatch: (id: string, patch: Partial<RaceSegment>) => void;
  onReset: (id: string) => void;
}

const SortableSegmentItem = React.memo(function SortableSegmentItem({
  segment,
  index,
  editable,
  divisionKey,
  onRemove,
  onPatch,
  onReset,
}: SortableSegmentItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: segment.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isRun = segment.segmentType === "run";
  const isRoxzone = segment.segmentSubtype === "roxzone";
  const bgColor = isRoxzone
    ? "bg-teal-500/[0.06]"
    : isRun
      ? "bg-blue-500/[0.08]"
      : "bg-orange-500/[0.08]";
  const borderColor = isRoxzone
    ? "border-teal-500/20"
    : isRun
      ? "border-blue-500/20"
      : "border-orange-500/20";
  const iconColor = isRoxzone
    ? "text-teal-400"
    : isRun
      ? "text-blue-400"
      : "text-orange-400";

  const modified = editable && isSegmentModified(segment, divisionKey);

  // Per-station capabilities — drives which inline fields render.
  const canonical = isRun ? null : getCanonicalStation(divisionKey, segment.label);
  const paceType = isRun
    ? null
    : STATION_PACE_TYPE[segment.label] ?? "total";
  const hasDistanceField = !isRun && (canonical?.distance != null || paceType === "per500m");
  const hasRepsField = !isRun && (canonical?.reps != null || paceType === "perRep");
  const hasWeightField = !isRun && (canonical?.weightKg != null || segment.weightKg != null);

  // ----- Field handlers -----
  // Runs are edited as integer meters with a fixed "m" suffix so the
  // stored value matches what the user sees — no free-text "1km vs 1000m"
  // ambiguity. Display strings on save derive from the numeric value.
  const setRunMeters = (raw: string) => {
    const meters = parseInt(raw, 10);
    if (Number.isNaN(meters) || meters < 0) return;
    onPatch(segment.id, {
      distance: `${meters}m`,
      distanceMeters: meters,
    });
  };
  const currentRunMeters =
    segment.distanceMeters ?? parseDistanceToMeters(segment.distance) ?? 0;

  const setStationDistance = (raw: string) => {
    const meters = parseDistanceToMeters(raw);
    if (meters == null) {
      onPatch(segment.id, { distance: raw });
      return;
    }
    onPatch(segment.id, {
      distance: `${meters}m`,
      distanceMeters: meters,
    });
  };

  const setReps = (raw: string) => {
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) return;
    onPatch(segment.id, { reps: Math.max(0, n) });
  };

  const setWeightKg = (raw: string) => {
    const n = parseFloat(raw);
    if (Number.isNaN(n)) return;
    onPatch(segment.id, {
      weightKg: n,
      weightLabel: `${n} kg`,
    });
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex flex-col gap-1.5 rounded-lg border px-2 py-2 ${bgColor} ${borderColor}`}
    >
      <div className="flex items-center gap-2">
        {/* Drag handle */}
        <button
          className="touch-none cursor-grab active:cursor-grabbing p-1 text-muted-foreground"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        {/* Index */}
        <span className={`text-xs font-bold w-5 text-center ${iconColor}`}>
          {index + 1}
        </span>

        {/* Icon */}
        {isRoxzone ? (
          <ArrowRightLeft className={`h-3.5 w-3.5 shrink-0 ${iconColor}`} />
        ) : isRun ? (
          <Footprints className={`h-3.5 w-3.5 shrink-0 ${iconColor}`} />
        ) : (
          <Dumbbell className={`h-3.5 w-3.5 shrink-0 ${iconColor}`} />
        )}

        {/* Label */}
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <span className="text-xs font-medium truncate">{segment.label}</span>
          {modified && (
            <span className="text-[9px] uppercase tracking-wider rounded-sm border border-orange-400/30 bg-orange-400/[0.08] px-1 py-px text-orange-300">
              modified
            </span>
          )}
        </div>

        {/* Right-side display / single-line edit for run */}
        {isRun ? (
          <div className="flex items-center gap-0.5">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={currentRunMeters || ""}
              onChange={(e) => setRunMeters(e.target.value)}
              className="w-14 text-xs text-right font-mono bg-transparent border-b border-white/10 focus:border-blue-400 outline-none px-1 py-0.5 text-foreground"
            />
            <span className="text-[10px] font-mono text-muted-foreground">m</span>
          </div>
        ) : !editable ? (
          // Compact read-only summary when not editable.
          <span className="text-[11px] text-muted-foreground font-mono whitespace-nowrap">
            {segment.distance
              ? segment.distance
              : segment.reps
                ? `${segment.reps} reps`
                : ""}
            {segment.weightLabel ? ` @ ${segment.weightLabel}` : ""}
          </span>
        ) : null}

        {/* Reset (only when editable + modified) */}
        {editable && modified && (
          <button
            onClick={() => onReset(segment.id)}
            className="p-1 text-muted-foreground hover:text-orange-400 transition-colors"
            aria-label="Reset to division default"
            title="Reset to division default"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        )}

        {/* Remove */}
        <button
          onClick={() => onRemove(segment.id)}
          className="p-1 text-muted-foreground hover:text-red-400 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Editable station fields — second row */}
      {editable && !isRun && (
        <div className="flex flex-wrap items-center gap-3 pl-8 pt-1">
          {hasDistanceField && (
            <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span>Distance</span>
              <input
                type="number"
                min={0}
                value={
                  segment.distanceMeters ??
                  parseDistanceToMeters(segment.distance) ??
                  ""
                }
                onChange={(e) => setStationDistance(`${e.target.value}m`)}
                className="w-16 text-xs font-mono bg-transparent border-b border-white/10 focus:border-orange-400 outline-none px-1 py-0.5 text-foreground"
              />
              <span>m</span>
            </label>
          )}
          {hasRepsField && (
            <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span>Reps</span>
              <input
                type="number"
                min={0}
                value={segment.reps ?? ""}
                onChange={(e) => setReps(e.target.value)}
                className="w-14 text-xs font-mono bg-transparent border-b border-white/10 focus:border-orange-400 outline-none px-1 py-0.5 text-foreground"
              />
            </label>
          )}
          {hasWeightField && (
            <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span>Weight</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={segment.weightKg ?? ""}
                onChange={(e) => setWeightKg(e.target.value)}
                className="w-16 text-xs font-mono bg-transparent border-b border-white/10 focus:border-orange-400 outline-none px-1 py-0.5 text-foreground"
              />
              <span>kg</span>
            </label>
          )}
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Segment list
// ---------------------------------------------------------------------------

interface SegmentListProps {
  segments: RaceSegment[];
  onChange: (segments: RaceSegment[]) => void;
  /** When true, station distance/reps/weight become editable. */
  editable?: boolean;
  /** Division context, used to compute modified state and reset values. */
  divisionKey?: DivisionKey;
}

export function SegmentList({
  segments,
  onChange,
  editable = false,
  divisionKey,
}: SegmentListProps) {
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 5 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 150, tolerance: 5 },
  });
  const sensors = useSensors(pointerSensor, touchSensor);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = segments.findIndex((s) => s.id === active.id);
      const newIndex = segments.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      onChange(arrayMove(segments, oldIndex, newIndex));
    },
    [segments, onChange],
  );

  const handleRemove = useCallback(
    (id: string) => {
      onChange(segments.filter((s) => s.id !== id));
    },
    [segments, onChange],
  );

  const handlePatch = useCallback(
    (id: string, patch: Partial<RaceSegment>) => {
      onChange(segments.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    },
    [segments, onChange],
  );

  const handleReset = useCallback(
    (id: string) => {
      const seg = segments.find((s) => s.id === id);
      if (!seg) return;
      if (seg.segmentType === "run") {
        if (!divisionKey) return;
        const div = DIVISIONS[divisionKey];
        if (!div) return;
        const meters =
          seg.segmentSubtype === "roxzone" ? 100 : div.runDistanceM;
        const display =
          meters >= 1000 ? `${meters / 1000} km` : `${meters}m`;
        handlePatch(id, { distance: display, distanceMeters: meters });
        return;
      }
      const canonical = getCanonicalStation(divisionKey, seg.label);
      if (!canonical) return;
      handlePatch(id, {
        distance: canonical.distance,
        distanceMeters: parseDistanceToMeters(canonical.distance) ?? undefined,
        reps: canonical.reps,
        weightKg: canonical.weightKg,
        weightLabel: canonical.weightLabel,
      });
    },
    [segments, divisionKey, handlePatch],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={segments.map((s) => s.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col gap-1.5">
          {segments.map((segment, index) => (
            <SortableSegmentItem
              key={segment.id}
              segment={segment}
              index={index}
              editable={editable}
              divisionKey={divisionKey}
              onRemove={handleRemove}
              onPatch={handlePatch}
              onReset={handleReset}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
