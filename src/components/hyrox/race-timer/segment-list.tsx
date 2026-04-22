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
import { GripVertical, X, Footprints, Dumbbell } from "lucide-react";
import type { RaceSegment } from "./types";

// ---------------------------------------------------------------------------
// Sortable segment item
// ---------------------------------------------------------------------------

const SortableSegmentItem = React.memo(function SortableSegmentItem({
  segment,
  index,
  onRemove,
  onEditDistance,
}: {
  segment: RaceSegment;
  index: number;
  onRemove: (id: string) => void;
  onEditDistance: (id: string, distance: string) => void;
}) {
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
  const bgColor = isRun ? "bg-blue-500/[0.08]" : "bg-orange-500/[0.08]";
  const borderColor = isRun
    ? "border-blue-500/20"
    : "border-orange-500/20";
  const iconColor = isRun ? "text-blue-400" : "text-orange-400";

  const spec = segment.distance
    ? segment.distance
    : segment.reps
      ? `${segment.reps} reps`
      : "";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-lg border px-2 py-2 ${bgColor} ${borderColor}`}
    >
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
      {isRun ? (
        <Footprints className={`h-3.5 w-3.5 shrink-0 ${iconColor}`} />
      ) : (
        <Dumbbell className={`h-3.5 w-3.5 shrink-0 ${iconColor}`} />
      )}

      {/* Label */}
      <span className="text-xs font-medium flex-1 min-w-0 truncate">
        {segment.label}
      </span>

      {/* Distance/spec — editable for runs */}
      {isRun ? (
        <input
          type="text"
          value={segment.distance ?? "1 km"}
          onChange={(e) => onEditDistance(segment.id, e.target.value)}
          className="w-14 text-xs text-right font-mono bg-transparent border-b border-white/10 focus:border-blue-400 outline-none px-1 py-0.5 text-muted-foreground"
        />
      ) : (
        <span className="text-[11px] text-muted-foreground font-mono whitespace-nowrap">
          {spec}
          {segment.weightLabel ? ` @ ${segment.weightLabel}` : ""}
        </span>
      )}

      {/* Remove */}
      <button
        onClick={() => onRemove(segment.id)}
        className="p-1 text-muted-foreground hover:text-red-400 transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Segment list
// ---------------------------------------------------------------------------

interface SegmentListProps {
  segments: RaceSegment[];
  onChange: (segments: RaceSegment[]) => void;
}

export function SegmentList({ segments, onChange }: SegmentListProps) {
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

  const handleEditDistance = useCallback(
    (id: string, distance: string) => {
      onChange(
        segments.map((s) => (s.id === id ? { ...s, distance } : s)),
      );
    },
    [segments, onChange],
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
              onRemove={handleRemove}
              onEditDistance={handleEditDistance}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
