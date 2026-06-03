"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Trash2,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Loader2,
  Check,
  Plus,
  X,
  GripVertical,
} from "lucide-react";
import {
  DndContext,
  closestCorners,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MovementSearch } from "@/components/crossfit/movement-search";
import { DurationInput } from "@/components/crossfit/duration-input";
import {
  useCreateMovement,
  useMovements,
  type CreateMovementInput,
} from "@/hooks/useMovements";
import { AdvancedMovementForm } from "@/components/crossfit/advanced-movement-form";
import {
  parseRepScheme,
  canPromoteSequenceToLadder,
} from "@/lib/crossfit/rep-scheme-parser";
import {
  MOVEMENT_METRIC_TYPES,
} from "@/types/crossfit";
import type {
  WorkoutBuilderMovement,
  WorkoutBuilderBlock,
  MovementOption,
  MovementMetricType,
  RxField,
  RxDefaults,
  WorkoutType,
} from "@/types/crossfit";

function generateTempId() {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateBlockTempId() {
  return `block-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// An earlier for_load part this part's movements may anchor a weight_pct
// prescription to. `tempId` is the source part's builder tempId; `label` is
// the human label shown in the picker. Empty list = no weight_pct option.
export interface EarlierLoadPart {
  tempId: string;
  label: string;
}

interface MovementListBuilderProps {
  movements: WorkoutBuilderMovement[];
  onChange: (movements: WorkoutBuilderMovement[]) => void;
  // Named groupings under this part. Movements join blocks via
  // `blockTempRef`. When `blocks` is empty, movements render flat (legacy
  // behavior). The "Add a block" button always shows so users can promote
  // into the grouped layout.
  blocks: WorkoutBuilderBlock[];
  onBlocksChange: (blocks: WorkoutBuilderBlock[]) => void;
  // For Load workouts have no prescribed weight (the athlete is *finding* the
  // load), so we suppress the Rx weight inputs in that mode.
  workoutType?: WorkoutType;
  // When the parent part has a side-cadence configured, show a toggle
  // per movement that lets the user mark it as the side-cadence movement
  // (runs on the cadence rather than as part of the main task).
  showSideCadence?: boolean;
  // Earlier for_load parts a movement's weight can be prescribed as a
  // percentage of. Empty/undefined hides the "% of earlier part" toggle.
  earlierLoadParts?: EarlierLoadPart[];
  // Part-level shared rep scheme. When set (e.g. "1-2-3-..." on an AMRAP),
  // freshly-added movements inherit it as their `prescribedReps` so the
  // admin doesn't lose the shared scheme by adding a movement after typing
  // it. Per-movement edits still win — this only prefills the empty case.
  partRepScheme?: string;
}

// ============================================
// Helpers — read Rx settings off the movement library or the carried copy.
// ============================================
//
// `rxFields` / `rxDefaults` / `supportedMetricTypes` live on the movements
// table (Phase 2). The builder movement carries a snapshot at add-time, but
// we always prefer the live library lookup when available so admin tweaks
// to the seed values flow through to in-flight builders.
//
// Empty rx_fields is the rollback signal: we drop back to the legacy
// hardcoded branches (`mov.metricType` switch + regex helpers) so a single
// `UPDATE movements SET rx_fields = '{}'` reverts that movement to the old
// behavior without a deploy.

function resolveRxFields(
  mov: WorkoutBuilderMovement,
  library: MovementOption[]
): RxField[] {
  const fromLib = mov.movementId
    ? library.find((m) => m.id === mov.movementId)?.rxFields
    : undefined;
  return fromLib ?? mov.rxFields ?? [];
}

function resolveRxDefaults(
  mov: WorkoutBuilderMovement,
  library: MovementOption[]
): RxDefaults {
  const fromLib = mov.movementId
    ? library.find((m) => m.id === mov.movementId)?.rxDefaults
    : undefined;
  return fromLib ?? mov.rxDefaults ?? {};
}

function resolveSupportedMetricTypes(
  mov: WorkoutBuilderMovement,
  library: MovementOption[]
): MovementMetricType[] {
  const fromLib = mov.movementId
    ? library.find((m) => m.id === mov.movementId)?.supportedMetricTypes
    : undefined;
  const carried = fromLib ?? mov.supportedMetricTypes;
  if (carried && carried.length > 0) return carried;
  // Un-backfilled fallback: just expose the single metric type the row
  // already declares so the toggle still works.
  return [mov.metricType];
}

function asString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

// Build the WorkoutBuilderMovement starting state for a freshly-added movement.
// Pre-fills every gendered prescription field from rx_defaults so the user
// sees Box Jump 24/20, Thruster 95/65, etc. without typing.
function makeBuilderMovement(option: MovementOption): WorkoutBuilderMovement {
  const rxFields = option.rxFields ?? [];
  const defaults = option.rxDefaults ?? {};

  const wantsHeight = rxFields.includes("height");
  const wantsWeight = rxFields.includes("weight");
  const wantsDuration = rxFields.includes("duration");

  return {
    tempId: generateTempId(),
    movementId: option.id,
    movementName: option.canonicalName,
    category: option.category,
    isWeighted: option.isWeighted,
    is1rmApplicable: option.is1rmApplicable,
    metricType: option.metricType,
    supportedMetricTypes: option.supportedMetricTypes,
    rxFields: option.rxFields,
    rxDefaults: option.rxDefaults,
    prescribedReps: "",
    prescribedWeightMale: wantsWeight
      ? asString(defaults.weight_male) || option.commonRxWeightMale || ""
      : option.commonRxWeightMale || "",
    prescribedWeightFemale: wantsWeight
      ? asString(defaults.weight_female) || option.commonRxWeightFemale || ""
      : option.commonRxWeightFemale || "",
    prescribedCaloriesMale: asString(defaults.calories_male),
    prescribedCaloriesFemale: asString(defaults.calories_female),
    prescribedDistanceMale: asString(defaults.distance_male),
    prescribedDistanceFemale: asString(defaults.distance_female),
    prescribedDurationSecondsMale: wantsDuration
      ? asString(defaults.duration_seconds_male)
      : "",
    prescribedDurationSecondsFemale: wantsDuration
      ? asString(defaults.duration_seconds_female)
      : "",
    prescribedHeightInches: "",
    prescribedHeightInchesMale: wantsHeight
      ? asString(defaults.height_inches_male)
      : "",
    prescribedHeightInchesFemale: wantsHeight
      ? asString(defaults.height_inches_female)
      : "",
    prescribedWeightMaleBwMultiplier: "",
    prescribedWeightFemaleBwMultiplier: "",
    prescribedWeightPct: asString(defaults.weight_pct),
    tempo: defaults.tempo ?? "",
    isMaxReps: false,
    captureDurationPerRound: false,
    isSideCadence: false,
    rxStandard: "",
    notes: "",
    weightSource: "prescribed",
  };
}

// ============================================
// Section ids
// ============================================
//
// dnd-kit needs a stable id for each droppable. Movement rows use their
// `tempId`; sections use `section:<ref>` where ref is "ungrouped" or a
// block's tempId. The drag-end handler decodes the prefix to figure out
// where the dragged item should land.

const UNGROUPED_SECTION_ID = "section:ungrouped";
const sectionIdForBlock = (blockTempId: string) => `section:${blockTempId}`;

export function MovementListBuilder({
  movements,
  onChange,
  blocks,
  onBlocksChange,
  workoutType,
  showSideCadence = false,
  earlierLoadParts = [],
  partRepScheme,
}: MovementListBuilderProps) {
  const showRxWeights = workoutType !== "for_load";
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [creatingName, setCreatingName] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  // The Advanced creation form is opt-in — typing a name and hitting enter
  // still uses the fast-path. The toggle exists so power users (Sarah) can
  // declare rx_fields up front. New movements added via the advanced form
  // land in the ungrouped section; the user can drag them into a block.
  const [advancedFormOpen, setAdvancedFormOpen] = useState(false);
  const createMovement = useCreateMovement();
  const { data: movementLibrary = [] } = useMovements();

  const toggleExpanded = useCallback((tempId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(tempId)) next.delete(tempId);
      else next.add(tempId);
      return next;
    });
  }, []);

  // Inherit the part's shared rep scheme into the new movement if the
  // movement doesn't already carry one. Mirrors the prefill in the part
  // editor's rep-scheme input, but covers the timing gap when movements
  // are added AFTER the rep scheme is typed.
  const applyPartRepScheme = useCallback(
    (mov: WorkoutBuilderMovement): WorkoutBuilderMovement => {
      const shared = partRepScheme?.trim();
      if (!shared) return mov;
      if (mov.prescribedReps && mov.prescribedReps.trim()) return mov;
      return { ...mov, prescribedReps: shared };
    },
    [partRepScheme]
  );

  // Adding a movement is section-aware: the new movement gets the right
  // `blockTempRef` baked in so it lands in the section the user clicked
  // "Add" under.
  const addMovementToSection = useCallback(
    (option: MovementOption, sectionRef: string | null) => {
      const newMov = applyPartRepScheme(makeBuilderMovement(option));
      if (sectionRef) newMov.blockTempRef = sectionRef;
      onChange([...movements, newMov]);
    },
    [applyPartRepScheme, movements, onChange]
  );

  const addCustomMovementToSection = useCallback(
    async (name: string, sectionRef: string | null) => {
      setCreateError(null);
      setCreatingName(name);
      try {
        const created = await createMovement.mutateAsync({
          canonicalName: name,
        });
        const newMov = applyPartRepScheme(makeBuilderMovement(created));
        if (sectionRef) newMov.blockTempRef = sectionRef;
        onChange([...movements, newMov]);
      } catch (err) {
        setCreateError(
          err instanceof Error ? err.message : "Failed to add movement"
        );
      } finally {
        setCreatingName(null);
      }
    },
    [applyPartRepScheme, createMovement, movements, onChange]
  );

  const addAdvancedMovement = useCallback(
    async (input: CreateMovementInput) => {
      setCreateError(null);
      setCreatingName(input.canonicalName);
      try {
        const created = await createMovement.mutateAsync(input);
        onChange([
          ...movements,
          applyPartRepScheme(makeBuilderMovement(created)),
        ]);
        setAdvancedFormOpen(false);
      } catch (err) {
        setCreateError(
          err instanceof Error ? err.message : "Failed to add movement"
        );
      } finally {
        setCreatingName(null);
      }
    },
    [applyPartRepScheme, createMovement, movements, onChange]
  );

  const updateMovement = useCallback(
    (tempId: string, updates: Partial<WorkoutBuilderMovement>) => {
      onChange(
        movements.map((m) => (m.tempId === tempId ? { ...m, ...updates } : m))
      );
    },
    [movements, onChange]
  );

  const removeMovement = useCallback(
    (tempId: string) => {
      onChange(movements.filter((m) => m.tempId !== tempId));
    },
    [movements, onChange]
  );

  // ↑ ↓ buttons reorder *within* a section. Cross-section moves go through
  // drag-and-drop. Keeping the buttons gives users a non-DnD path that's
  // friendlier on mobile when a tap is more reliable than a long-press
  // drag.
  const moveMovementWithinSection = useCallback(
    (tempId: string, direction: "up" | "down") => {
      const idx = movements.findIndex((m) => m.tempId === tempId);
      if (idx === -1) return;
      const myRef = movements[idx].blockTempRef ?? null;
      const siblingIdxs: number[] = [];
      movements.forEach((m, i) => {
        if ((m.blockTempRef ?? null) === myRef) siblingIdxs.push(i);
      });
      const myPos = siblingIdxs.indexOf(idx);
      const swapPos = direction === "up" ? myPos - 1 : myPos + 1;
      if (swapPos < 0 || swapPos >= siblingIdxs.length) return;
      const swapIdx = siblingIdxs[swapPos];
      const next = [...movements];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      onChange(next);
    },
    [movements, onChange]
  );

  // ============================================
  // Block handlers
  // ============================================

  const addBlock = useCallback(() => {
    const newBlock: WorkoutBuilderBlock = {
      tempId: generateBlockTempId(),
      title: "",
      orderIndex: blocks.length,
    };
    onBlocksChange([...blocks, newBlock]);
  }, [blocks, onBlocksChange]);

  const updateBlock = useCallback(
    (tempId: string, updates: Partial<WorkoutBuilderBlock>) => {
      onBlocksChange(
        blocks.map((b) => (b.tempId === tempId ? { ...b, ...updates } : b))
      );
    },
    [blocks, onBlocksChange]
  );

  const deleteBlock = useCallback(
    (tempId: string) => {
      // Member movements fall back to ungrouped — preserve their data, just
      // clear the block pointers. blockId is cleared too so the server
      // doesn't try to resolve a stale reference.
      onBlocksChange(blocks.filter((b) => b.tempId !== tempId));
      onChange(
        movements.map((m) =>
          m.blockTempRef === tempId
            ? { ...m, blockTempRef: null, blockId: null }
            : m
        )
      );
    },
    [blocks, onBlocksChange, movements, onChange]
  );

  const moveBlock = useCallback(
    (tempId: string, direction: "up" | "down") => {
      const idx = blocks.findIndex((b) => b.tempId === tempId);
      if (idx === -1) return;
      const swap = direction === "up" ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= blocks.length) return;
      const next = [...blocks];
      [next[idx], next[swap]] = [next[swap], next[idx]];
      onBlocksChange(next.map((b, i) => ({ ...b, orderIndex: i })));
    },
    [blocks, onBlocksChange]
  );

  // ============================================
  // Drag and drop
  // ============================================
  //
  // - PointerSensor with a small distance threshold so a tap on the card
  //   body (e.g. to expand) doesn't start a drag.
  // - TouchSensor with a delay so iOS scrolling still works; a long-press
  //   on the grip handle is what initiates a drag.

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;
      const activeId = String(active.id);
      const overId = String(over.id);
      if (activeId === overId) return;

      const activeMov = movements.find((m) => m.tempId === activeId);
      if (!activeMov) return;

      // Decode where the drop landed. Section ids are prefixed; movement
      // ids are bare tempIds.
      let targetRef: string | null;
      let targetMovTempId: string | null = null;
      if (overId.startsWith("section:")) {
        const ref = overId.slice("section:".length);
        targetRef = ref === "ungrouped" ? null : ref;
      } else {
        const overMov = movements.find((m) => m.tempId === overId);
        if (!overMov) return;
        targetRef = overMov.blockTempRef ?? null;
        targetMovTempId = overId;
      }

      const currentRef = activeMov.blockTempRef ?? null;

      // Swap blockTempRef first (cross-section move), then reorder. blockId
      // is cleared so the server resolves the new section via tempRef
      // rather than an old, now-stale db id.
      let next = movements;
      if (currentRef !== targetRef) {
        next = next.map((m) =>
          m.tempId === activeId
            ? { ...m, blockTempRef: targetRef, blockId: null }
            : m
        );
      }

      const oldIdx = next.findIndex((m) => m.tempId === activeId);
      let newIdx: number;
      if (targetMovTempId) {
        newIdx = next.findIndex((m) => m.tempId === targetMovTempId);
      } else {
        // Section drop target (empty section, or end-of-section drop).
        // Land at the end of the target section.
        let last = -1;
        next.forEach((m, i) => {
          if (i !== oldIdx && (m.blockTempRef ?? null) === targetRef) last = i;
        });
        newIdx = oldIdx > last ? last + 1 : last;
        if (newIdx < 0) newIdx = 0;
      }

      if (oldIdx === newIdx && currentRef === targetRef) return;
      next = arrayMove(next, oldIdx, newIdx);
      onChange(next);
    },
    [movements, onChange]
  );

  // ============================================
  // Section grouping
  // ============================================

  const ungroupedMovements = useMemo(
    () => movements.filter((m) => !m.blockTempRef),
    [movements]
  );
  const movementsByBlock = useMemo(() => {
    const map = new Map<string, WorkoutBuilderMovement[]>();
    for (const block of blocks) map.set(block.tempId, []);
    for (const m of movements) {
      if (!m.blockTempRef) continue;
      const list = map.get(m.blockTempRef);
      if (list) list.push(m);
    }
    return map;
  }, [movements, blocks]);

  const hasBlocks = blocks.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-base font-semibold">Movements</Label>
        <span className="text-xs text-muted-foreground">
          {movements.length} movement{movements.length !== 1 ? "s" : ""}
        </span>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragEnd={handleDragEnd}
      >
        <div className="space-y-3">
          {/* Ungrouped section. Always rendered when blocks exist (so the
              user has a drop target to ungroup a movement); rendered as a
              flat list otherwise. */}
          {(hasBlocks || ungroupedMovements.length > 0 || !hasBlocks) && (
            <Section
              sectionId={UNGROUPED_SECTION_ID}
              showHeader={hasBlocks}
              movements={ungroupedMovements}
              onUpdateMovement={updateMovement}
              onRemoveMovement={removeMovement}
              onMoveMovement={moveMovementWithinSection}
              onToggleExpanded={toggleExpanded}
              expandedIds={expandedIds}
              workoutType={workoutType}
              showRxWeights={showRxWeights}
              showSideCadence={showSideCadence}
              earlierLoadParts={earlierLoadParts}
              movementLibrary={movementLibrary}
              onAddMovement={(opt) => addMovementToSection(opt, null)}
              onAddCustomMovement={(name) =>
                addCustomMovementToSection(name, null)
              }
              creatingName={creatingName}
              createError={createError}
            />
          )}

          {blocks.map((block, idx) => (
            <BlockSection
              key={block.tempId}
              block={block}
              index={idx}
              totalBlocks={blocks.length}
              movements={movementsByBlock.get(block.tempId) ?? []}
              onUpdateBlock={updateBlock}
              onDeleteBlock={deleteBlock}
              onMoveBlock={moveBlock}
              onUpdateMovement={updateMovement}
              onRemoveMovement={removeMovement}
              onMoveMovement={moveMovementWithinSection}
              onToggleExpanded={toggleExpanded}
              expandedIds={expandedIds}
              workoutType={workoutType}
              showRxWeights={showRxWeights}
              showSideCadence={showSideCadence}
              earlierLoadParts={earlierLoadParts}
              movementLibrary={movementLibrary}
              onAddMovement={(opt) =>
                addMovementToSection(opt, block.tempId)
              }
              onAddCustomMovement={(name) =>
                addCustomMovementToSection(name, block.tempId)
              }
              creatingName={creatingName}
              createError={createError}
            />
          ))}
        </div>
      </DndContext>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1 border-dashed text-xs gap-1"
          onClick={addBlock}
        >
          <Plus className="size-3.5" />
          Add a block
        </Button>
        <button
          type="button"
          onClick={() => setAdvancedFormOpen(true)}
          className="text-[11px] text-primary/80 hover:text-primary whitespace-nowrap"
        >
          + New Movement
        </button>
      </div>

      <AdvancedMovementForm
        open={advancedFormOpen}
        onOpenChange={setAdvancedFormOpen}
        onSubmit={addAdvancedMovement}
        submitLabel="Add to Workout"
      />
    </div>
  );
}

// ============================================
// Section components
// ============================================
//
// `Section` is the ungrouped bucket; `BlockSection` adds the editable
// header (title, reorder, delete). They share the same body — a sortable
// list of movement cards plus an inline MovementSearch — so changes to the
// row UI only have to be made in one place (MovementCard).

interface SectionBodyProps {
  movements: WorkoutBuilderMovement[];
  onUpdateMovement: (
    tempId: string,
    updates: Partial<WorkoutBuilderMovement>
  ) => void;
  onRemoveMovement: (tempId: string) => void;
  onMoveMovement: (tempId: string, direction: "up" | "down") => void;
  onToggleExpanded: (tempId: string) => void;
  expandedIds: Set<string>;
  workoutType?: WorkoutType;
  showRxWeights: boolean;
  showSideCadence: boolean;
  earlierLoadParts: EarlierLoadPart[];
  movementLibrary: MovementOption[];
  onAddMovement: (option: MovementOption) => void;
  onAddCustomMovement: (name: string) => void;
  creatingName: string | null;
  createError: string | null;
}

function Section({
  sectionId,
  showHeader,
  movements,
  ...rest
}: SectionBodyProps & {
  sectionId: string;
  showHeader: boolean;
}) {
  return (
    <div
      className={
        showHeader
          ? "rounded-md border border-border/40 bg-muted/10 p-2.5 space-y-2"
          : "space-y-2"
      }
    >
      {showHeader && (
        <div className="flex items-center gap-1.5">
          <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Ungrouped
          </Label>
          <span className="text-[11px] text-muted-foreground/60">
            (not in a block)
          </span>
        </div>
      )}
      <SectionBody sectionId={sectionId} movements={movements} {...rest} />
    </div>
  );
}

function BlockSection({
  block,
  index,
  totalBlocks,
  movements,
  onUpdateBlock,
  onDeleteBlock,
  onMoveBlock,
  ...rest
}: SectionBodyProps & {
  block: WorkoutBuilderBlock;
  index: number;
  totalBlocks: number;
  onUpdateBlock: (tempId: string, updates: Partial<WorkoutBuilderBlock>) => void;
  onDeleteBlock: (tempId: string) => void;
  onMoveBlock: (tempId: string, direction: "up" | "down") => void;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/15 p-2.5 space-y-2">
      <div className="flex items-center gap-1.5">
        <Input
          value={block.title}
          onChange={(e) =>
            onUpdateBlock(block.tempId, { title: e.target.value })
          }
          placeholder={`Block ${index + 1} title`}
          className="h-8 flex-1 text-xs font-medium"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => onMoveBlock(block.tempId, "up")}
          disabled={index === 0}
          aria-label="Move block up"
        >
          <ChevronUp className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => onMoveBlock(block.tempId, "down")}
          disabled={index === totalBlocks - 1}
          aria-label="Move block down"
        >
          <ChevronDown className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => onDeleteBlock(block.tempId)}
          className="text-destructive hover:text-destructive"
          aria-label="Delete block"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      <SectionBody
        sectionId={sectionIdForBlock(block.tempId)}
        movements={movements}
        {...rest}
      />
    </div>
  );
}

function SectionBody({
  sectionId,
  movements,
  onUpdateMovement,
  onRemoveMovement,
  onMoveMovement,
  onToggleExpanded,
  expandedIds,
  workoutType,
  showRxWeights,
  showSideCadence,
  earlierLoadParts,
  movementLibrary,
  onAddMovement,
  onAddCustomMovement,
  creatingName,
  createError,
}: SectionBodyProps & { sectionId: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: sectionId });
  const itemIds = useMemo(() => movements.map((m) => m.tempId), [movements]);

  return (
    <div
      ref={setNodeRef}
      className={`space-y-2 rounded-md transition-colors ${
        isOver ? "bg-primary/5 ring-1 ring-primary/30" : ""
      }`}
    >
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        {movements.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/40 px-3 py-4 text-center text-[11px] text-muted-foreground">
            Drop a movement here, or add one below.
          </div>
        ) : (
          movements.map((mov, idx) => (
            <SortableMovementCard
              key={mov.tempId}
              movement={mov}
              index={idx}
              total={movements.length}
              onUpdate={onUpdateMovement}
              onRemove={onRemoveMovement}
              onMove={onMoveMovement}
              onToggleExpanded={onToggleExpanded}
              isExpanded={expandedIds.has(mov.tempId)}
              workoutType={workoutType}
              showRxWeights={showRxWeights}
              showSideCadence={showSideCadence}
              earlierLoadParts={earlierLoadParts}
              movementLibrary={movementLibrary}
            />
          ))
        )}
      </SortableContext>

      <MovementSearch
        onSelect={onAddMovement}
        onAddNew={onAddCustomMovement}
        placeholder="Add movement…"
      />
      {creatingName && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Saving &quot;{creatingName}&quot; to your movements…
        </p>
      )}
      {createError && (
        <p className="text-xs text-destructive">{createError}</p>
      )}
    </div>
  );
}

// ============================================
// Sortable wrapper + movement card
// ============================================

interface MovementCardProps {
  movement: WorkoutBuilderMovement;
  index: number;
  total: number;
  onUpdate: (tempId: string, updates: Partial<WorkoutBuilderMovement>) => void;
  onRemove: (tempId: string) => void;
  onMove: (tempId: string, direction: "up" | "down") => void;
  onToggleExpanded: (tempId: string) => void;
  isExpanded: boolean;
  workoutType?: WorkoutType;
  showRxWeights: boolean;
  showSideCadence: boolean;
  earlierLoadParts: EarlierLoadPart[];
  movementLibrary: MovementOption[];
}

function SortableMovementCard(props: MovementCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.movement.tempId });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <MovementCard {...props} dragListeners={listeners} />
    </div>
  );
}

function MovementCard({
  movement: mov,
  index: idx,
  total,
  onUpdate,
  onRemove,
  onMove,
  onToggleExpanded,
  isExpanded,
  workoutType,
  showRxWeights,
  showSideCadence,
  earlierLoadParts,
  movementLibrary,
  dragListeners,
}: MovementCardProps & { dragListeners?: Record<string, unknown> }) {
  const rxFields = resolveRxFields(mov, movementLibrary);
  const rxDefaults = resolveRxDefaults(mov, movementLibrary);
  const supportedMetricTypes = resolveSupportedMetricTypes(mov, movementLibrary);
  const useLegacyBranches = rxFields.length === 0;

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-2">
      {/* Header row */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          {...(dragListeners ?? {})}
          className="shrink-0 touch-none cursor-grab active:cursor-grabbing rounded p-0.5 -ml-0.5 text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
          aria-label="Drag to reorder or move between blocks"
        >
          <GripVertical className="size-3.5" />
        </button>
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
          {idx + 1}
        </span>
        <button
          type="button"
          className="flex flex-1 items-center gap-1 text-left"
          onClick={() => onToggleExpanded(mov.tempId)}
        >
          <span className="flex-1 font-medium text-sm">
            {mov.movementName}
          </span>
          <ChevronRight
            className={`size-3.5 text-muted-foreground transition-transform ${
              isExpanded ? "rotate-90" : ""
            }`}
          />
        </button>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => onMove(mov.tempId, "up")}
            disabled={idx === 0}
          >
            <ChevronUp className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => onMove(mov.tempId, "down")}
            disabled={idx === total - 1}
          >
            <ChevronDown className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => onRemove(mov.tempId)}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Reps — visible for everything except duration-typed movements
          (Rest, Plank, etc.). For_load uses the per-movement rep scheme
          (e.g. "10-10-7-7-3-3-3" for a deadlift wave). Suppressed entirely
          when isMaxReps is on (the count comes from score-entry, per
          round). */}
      {mov.metricType !== "duration" && !mov.isMaxReps && (
        <RepSchemeField
          value={mov.prescribedReps}
          onChange={(reps) =>
            onUpdate(mov.tempId, { prescribedReps: reps })
          }
          promoteSequenceToLadder={!!mov.promoteSequenceToLadder}
          onPromoteChange={(promote) =>
            onUpdate(mov.tempId, { promoteSequenceToLadder: promote })
          }
          workoutType={workoutType}
          hasTimeCap={
            !!mov.prescribedDurationSecondsMale ||
            !!mov.prescribedDurationSecondsFemale
          }
          onAddTimeCap={() =>
            onUpdate(mov.tempId, { prescribedDurationSecondsMale: " " })
          }
        />
      )}

      {showSideCadence && (
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={!!mov.isSideCadence}
            onChange={(e) =>
              onUpdate(mov.tempId, { isSideCadence: e.target.checked })
            }
            className="size-3 cursor-pointer"
          />
          Side cadence (every interval)
          {mov.isSideCadence && (
            <span className="rounded bg-cyan-500/15 px-1 py-px text-[10px] font-bold text-cyan-300">
              EMOM
            </span>
          )}
        </label>
      )}

      {/* Hide isMaxReps + per-round time capture on timed_rounds parts —
          the score for those parts is the round time itself (captured at
          the part level), so per-movement max-reps / per-round capture
          would conflict with the part's scoring contract. */}
      {workoutType !== "timed_rounds" && (
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={!!mov.isMaxReps}
            onChange={(e) =>
              onUpdate(mov.tempId, {
                isMaxReps: e.target.checked,
                ...(e.target.checked
                  ? { prescribedReps: "", captureDurationPerRound: false }
                  : {}),
              })
            }
            className="size-3 cursor-pointer"
          />
          {mov.metricType === "calories"
            ? "Max calories (score)"
            : mov.metricType === "distance"
              ? "Max distance (score)"
              : mov.metricType === "duration"
                ? "Max duration (score)"
                : "Max reps (score)"}
          {mov.isMaxReps && (
            <span className="rounded bg-amber-500/15 px-1 py-px text-[10px] font-bold text-amber-300">
              MAX
            </span>
          )}
        </label>
      )}

      {/* Per-round time capture — for prescriptions like "Run 400m × 3 as
          fast as possible". Athlete logs one time per round; the sum
          becomes the part's score. Only meaningful when the part has
          rounds, and mutually exclusive with isMaxReps. */}
      {(workoutType === "intervals" || workoutType === "for_time") && (
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={!!mov.captureDurationPerRound}
            onChange={(e) =>
              onUpdate(mov.tempId, {
                captureDurationPerRound: e.target.checked,
                ...(e.target.checked ? { isMaxReps: false } : {}),
              })
            }
            className="size-3 cursor-pointer"
          />
          Time per round (score)
          {mov.captureDurationPerRound && (
            <span className="rounded bg-emerald-500/15 px-1 py-px text-[10px] font-bold text-emerald-300">
              TIMED
            </span>
          )}
        </label>
      )}

      {!useLegacyBranches && (
        <>
          {rxFields.includes("weight") && showRxWeights && (
            <WeightOrBwInputs
              movement={mov}
              earlierLoadParts={earlierLoadParts}
              workoutType={workoutType}
              onUpdate={(updates) => onUpdate(mov.tempId, updates)}
            />
          )}
          {rxFields.includes("weight_bw") && showRxWeights && (
            <BwMultiplierInputs
              movement={mov}
              onUpdate={(updates) => onUpdate(mov.tempId, updates)}
            />
          )}
          {rxFields.includes("calories") && (
            <CaloriesInputs
              movement={mov}
              onUpdate={(updates) => onUpdate(mov.tempId, updates)}
            />
          )}
          {rxFields.includes("distance") && (
            <DistanceInputs
              movement={mov}
              onUpdate={(updates) => onUpdate(mov.tempId, updates)}
            />
          )}
          {rxFields.includes("duration") && (
            <DurationFields
              movement={mov}
              onUpdate={(updates) => onUpdate(mov.tempId, updates)}
              showClearButton={mov.metricType !== "duration"}
            />
          )}
          {rxFields.includes("height") && (
            <HeightInputs
              movement={mov}
              defaults={rxDefaults}
              onUpdate={(updates) => onUpdate(mov.tempId, updates)}
            />
          )}
          {rxFields.includes("tempo") && (
            <TempoInput
              value={mov.tempo}
              onChange={(v) => onUpdate(mov.tempId, { tempo: v })}
            />
          )}
        </>
      )}

      {useLegacyBranches && (
        <>
          {mov.metricType === "weight" && showRxWeights && (
            <WeightOrBwInputs
              movement={mov}
              earlierLoadParts={earlierLoadParts}
              workoutType={workoutType}
              onUpdate={(updates) => onUpdate(mov.tempId, updates)}
            />
          )}

          {mov.metricType === "calories" && (
            <CaloriesInputs
              movement={mov}
              onUpdate={(updates) => onUpdate(mov.tempId, updates)}
            />
          )}

          {mov.metricType === "distance" && (
            <DistanceInputs
              movement={mov}
              onUpdate={(updates) => onUpdate(mov.tempId, updates)}
            />
          )}

          {isLegacyRestMovement(mov) ? (
            <RestDurationField
              movement={mov}
              onUpdate={(updates) => onUpdate(mov.tempId, updates)}
            />
          ) : (
            (mov.metricType === "duration" ||
              mov.prescribedDurationSecondsMale ||
              mov.prescribedDurationSecondsFemale) && (
              <DurationFields
                movement={mov}
                onUpdate={(updates) => onUpdate(mov.tempId, updates)}
                showClearButton={mov.metricType !== "duration"}
              />
            )
          )}

          {isHeightBearing(mov.movementName) &&
            (isHeightDeficit(mov.movementName) ? (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Height (in)
                </Label>
                <Input
                  type="number"
                  min={0}
                  step="0.5"
                  value={
                    mov.prescribedHeightInchesMale ||
                    mov.prescribedHeightInches
                  }
                  onChange={(e) =>
                    onUpdate(mov.tempId, {
                      prescribedHeightInchesMale: e.target.value,
                      prescribedHeightInchesFemale: e.target.value,
                    })
                  }
                  placeholder="e.g. 4"
                  className="h-7 text-xs"
                />
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Height (M) — in
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.5"
                    value={mov.prescribedHeightInchesMale}
                    onChange={(e) =>
                      onUpdate(mov.tempId, {
                        prescribedHeightInchesMale: e.target.value,
                      })
                    }
                    placeholder="e.g. 24"
                    className="h-7 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Height (F) — in
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.5"
                    value={mov.prescribedHeightInchesFemale}
                    onChange={(e) =>
                      onUpdate(mov.tempId, {
                        prescribedHeightInchesFemale: e.target.value,
                      })
                    }
                    placeholder="e.g. 20"
                    className="h-7 text-xs"
                  />
                </div>
              </div>
            ))}
        </>
      )}

      {mov.isWeighted &&
        (mov.category === "dumbbell" || mov.category === "kettlebell") && (
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">
              {mov.category === "dumbbell"
                ? "Dumbbells per rep"
                : "Kettlebells per rep"}
            </Label>
            <div className="flex gap-1">
              {[1, 2].map((n) => {
                const selected = (mov.equipmentCount ?? 1) === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() =>
                      onUpdate(mov.tempId, {
                        equipmentCount: n === 1 ? undefined : n,
                      })
                    }
                    className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                      selected
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/50 text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </div>
        )}

      {isExpanded && (
        <div className="space-y-2 pt-1">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Metric type
            </Label>
            <div className="flex flex-wrap gap-1">
              {(supportedMetricTypes.length > 0
                ? supportedMetricTypes
                : MOVEMENT_METRIC_TYPES
              ).map((mt) => {
                const selected = mov.metricType === mt;
                return (
                  <button
                    key={mt}
                    type="button"
                    onClick={() => {
                      const updates: Partial<WorkoutBuilderMovement> = {
                        metricType: mt,
                      };
                      if (mt === "weight") updates.isWeighted = true;
                      if (
                        mt === "calories" ||
                        mt === "distance" ||
                        mt === "duration"
                      )
                        updates.isWeighted = false;
                      onUpdate(mov.tempId, updates);
                    }}
                    className={`rounded-md px-2 py-0.5 text-xs font-medium capitalize ${
                      selected
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/50 text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {mt}
                  </button>
                );
              })}
            </div>
          </div>

          {!rxFields.includes("tempo") && (
            <TempoInput
              value={mov.tempo}
              onChange={(v) => onUpdate(mov.tempId, { tempo: v })}
            />
          )}

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Height (in) — optional
            </Label>
            <Input
              type="number"
              min={0}
              step="0.5"
              value={mov.prescribedHeightInches}
              onChange={(e) =>
                onUpdate(mov.tempId, {
                  prescribedHeightInches: e.target.value,
                })
              }
              placeholder="e.g. 4 (deficit), 24 (box)"
              className="h-7 text-xs"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Rx Standard / Notes
            </Label>
            <Input
              value={mov.rxStandard}
              onChange={(e) =>
                onUpdate(mov.tempId, { rxStandard: e.target.value })
              }
              placeholder="e.g. Full squat, Chest to deck"
              className="h-7 text-xs"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// Per-field input components
// ============================================

interface MovementInputProps {
  movement: WorkoutBuilderMovement;
  onUpdate: (updates: Partial<WorkoutBuilderMovement>) => void;
}

// The weight metric block. Three mutually-exclusive notations:
//   - lb  — the gendered absolute-weight pair (default)
//   - bw  — × bodyweight multiplier ("Use × BW", barbell 1RMs only)
//   - pct — % of an earlier for_load part's logged max ("Use % of earlier
//           part", only when such a part exists)
// Switching modes clears the other modes' fields so a workout can't carry
// two conflicting prescriptions.
function WeightOrBwInputs({
  movement,
  onUpdate,
  earlierLoadParts,
  workoutType,
}: MovementInputProps & {
  earlierLoadParts: EarlierLoadPart[];
  workoutType?: WorkoutType;
}) {
  const useBw = !!movement.useBwMultiplier;
  const useWeightPct = !!movement.useWeightPct;
  const isAthlete = movement.weightSource === "athlete";
  // BW multiplier notation only makes sense on barbell 1RMs ("1.5× BW
  // back squat"). Hide the toggle elsewhere so users don't tag a
  // pull-up as "1.5× BW".
  const canUseBw = !!movement.is1rmApplicable;
  // % of an earlier max needs an earlier for_load part to anchor to.
  const canUsePct = earlierLoadParts.length > 0;
  // Athlete-picked weight is meaningful for parts where the WEIGHT is not
  // the score (it's the chip/secondary). for_load is excluded because the
  // weight IS the score there. for_time/for_reps/amrap/intervals = visible.
  const canUseAthlete =
    workoutType === "for_time" ||
    workoutType === "for_reps" ||
    workoutType === "amrap" ||
    workoutType === "intervals";

  const mode: "lb" | "bw" | "pct" | "athlete" = isAthlete
    ? "athlete"
    : useWeightPct
      ? "pct"
      : useBw
        ? "bw"
        : "lb";

  const switchTo = (next: "lb" | "bw" | "pct" | "athlete") => {
    if (next === "athlete") {
      // Athlete mode owns the weight prescription — clear every
      // prescribed-weight notation so saved state is unambiguous.
      onUpdate({
        weightSource: "athlete",
        useBwMultiplier: false,
        useWeightPct: false,
        prescribedWeightMale: "",
        prescribedWeightFemale: "",
        prescribedWeightMaleBwMultiplier: "",
        prescribedWeightFemaleBwMultiplier: "",
        prescribedWeightPct: "",
        weightPctSourcePartTempRef: null,
      });
    } else if (next === "bw") {
      onUpdate({
        weightSource: "prescribed",
        useBwMultiplier: true,
        useWeightPct: false,
        prescribedWeightMale: "",
        prescribedWeightFemale: "",
        prescribedWeightPct: "",
        weightPctSourcePartTempRef: null,
      });
    } else if (next === "pct") {
      onUpdate({
        weightSource: "prescribed",
        useWeightPct: true,
        useBwMultiplier: false,
        prescribedWeightMale: "",
        prescribedWeightFemale: "",
        prescribedWeightMaleBwMultiplier: "",
        prescribedWeightFemaleBwMultiplier: "",
        // Default to the most recent earlier for_load part — the common
        // "Part 1 builds load, Part 2 works at a %" shape.
        weightPctSourcePartTempRef:
          movement.weightPctSourcePartTempRef ??
          earlierLoadParts[earlierLoadParts.length - 1]?.tempId ??
          null,
      });
    } else {
      onUpdate({
        weightSource: "prescribed",
        useBwMultiplier: false,
        useWeightPct: false,
        prescribedWeightMaleBwMultiplier: "",
        prescribedWeightFemaleBwMultiplier: "",
        prescribedWeightPct: "",
        weightPctSourcePartTempRef: null,
      });
    }
  };

  return (
    <div className="space-y-1.5">
      {mode === "lb" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Rx Weight (M)
            </Label>
            <Input
              value={movement.prescribedWeightMale}
              onChange={(e) =>
                onUpdate({ prescribedWeightMale: e.target.value })
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
              value={movement.prescribedWeightFemale}
              onChange={(e) =>
                onUpdate({ prescribedWeightFemale: e.target.value })
              }
              placeholder="e.g. 95"
              className="h-7 text-xs"
            />
          </div>
        </div>
      )}
      {mode === "bw" && (
        <BwMultiplierInputs movement={movement} onUpdate={onUpdate} />
      )}
      {mode === "pct" && (
        <WeightPctInputs
          movement={movement}
          onUpdate={onUpdate}
          earlierLoadParts={earlierLoadParts}
        />
      )}
      {mode === "athlete" && (
        <div className="rounded-md border border-sky-500/30 bg-sky-500/5 px-2 py-1.5 text-[11px] text-sky-200">
          Athletes will enter the weight they used at score time.
        </div>
      )}
      {(canUseBw || canUsePct || canUseAthlete) && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {canUseBw && (
            <button
              type="button"
              onClick={() => switchTo(mode === "bw" ? "lb" : "bw")}
              className="text-[11px] text-primary/80 hover:text-primary"
            >
              {mode === "bw" ? "Use lb instead" : "Use × BW instead"}
            </button>
          )}
          {canUsePct && (
            <button
              type="button"
              onClick={() => switchTo(mode === "pct" ? "lb" : "pct")}
              className="text-[11px] text-primary/80 hover:text-primary"
            >
              {mode === "pct" ? "Use lb instead" : "Use % of earlier part"}
            </button>
          )}
          {canUseAthlete && (
            <button
              type="button"
              onClick={() => switchTo(mode === "athlete" ? "lb" : "athlete")}
              className="text-[11px] text-primary/80 hover:text-primary"
            >
              {mode === "athlete"
                ? "Use prescribed weight"
                : "Use athlete-picked weight"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// % of an earlier for_load part's max. Non-gendered (it's a % of the
// athlete's own max). The picker lists only earlier for_load parts; the
// concrete working weight is resolved at score-entry time.
function WeightPctInputs({
  movement,
  onUpdate,
  earlierLoadParts,
}: MovementInputProps & { earlierLoadParts: EarlierLoadPart[] }) {
  // Guard against a stale ref (source part deleted or reordered after this
  // one) so the Select still renders a valid value.
  const sourceRef =
    movement.weightPctSourcePartTempRef &&
    earlierLoadParts.some(
      (p) => p.tempId === movement.weightPctSourcePartTempRef
    )
      ? movement.weightPctSourcePartTempRef
      : "";

  return (
    <div className="space-y-1.5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Percentage</Label>
          <div className="relative">
            <Input
              type="number"
              min={0}
              step="1"
              value={movement.prescribedWeightPct}
              onChange={(e) =>
                onUpdate({ prescribedWeightPct: e.target.value })
              }
              placeholder="e.g. 60"
              className="h-7 pr-6 text-xs"
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              %
            </span>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Of part</Label>
          <Select
            value={sourceRef}
            onValueChange={(v) =>
              onUpdate({ weightPctSourcePartTempRef: v })
            }
          >
            <SelectTrigger className="h-7 text-xs">
              {/* Base UI's SelectValue renders the raw value (the part
                  tempId) unless given a formatter — map it to the label. */}
              <SelectValue placeholder="Pick a part">
                {(value) =>
                  earlierLoadParts.find((p) => p.tempId === value)?.label ??
                  "Pick a part"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {earlierLoadParts.map((p) => (
                <SelectItem key={p.tempId} value={p.tempId}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        The working weight is calculated from the athlete&apos;s logged max
        on that part when they enter their score.
      </p>
    </div>
  );
}

function BwMultiplierInputs({ movement, onUpdate }: MovementInputProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">
          × Bodyweight (M)
        </Label>
        <Input
          type="number"
          min={0}
          step="0.05"
          value={movement.prescribedWeightMaleBwMultiplier}
          onChange={(e) =>
            onUpdate({
              prescribedWeightMaleBwMultiplier: e.target.value,
            })
          }
          placeholder="e.g. 1.5"
          className="h-7 text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">
          × Bodyweight (F)
        </Label>
        <Input
          type="number"
          min={0}
          step="0.05"
          value={movement.prescribedWeightFemaleBwMultiplier}
          onChange={(e) =>
            onUpdate({
              prescribedWeightFemaleBwMultiplier: e.target.value,
            })
          }
          placeholder="e.g. 1.25"
          className="h-7 text-xs"
        />
      </div>
    </div>
  );
}

function CaloriesInputs({ movement, onUpdate }: MovementInputProps) {
  return (
    <div className="space-y-1">
      {/* Mini-header so the M/F split reads clearly even when the gendered
          numbers diverge ("75-50-25 (M) / 60-40-20 (F)" cal-row). */}
      <Label className="text-xs text-muted-foreground">
        Calories — gendered
      </Label>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground/80">
            Cals (M)
          </Label>
          <Input
            value={movement.prescribedCaloriesMale}
            onChange={(e) =>
              onUpdate({ prescribedCaloriesMale: e.target.value })
            }
            placeholder="e.g. 15 or 75-50-25"
            className="h-7 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground/80">
            Cals (F)
          </Label>
          <Input
            value={movement.prescribedCaloriesFemale}
            onChange={(e) =>
              onUpdate({ prescribedCaloriesFemale: e.target.value })
            }
            placeholder="e.g. 12 or 60-40-20"
            className="h-7 text-xs"
          />
        </div>
      </div>
    </div>
  );
}

function DistanceInputs({ movement, onUpdate }: MovementInputProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">
          Distance (M) — meters
        </Label>
        <Input
          value={movement.prescribedDistanceMale}
          onChange={(e) =>
            onUpdate({ prescribedDistanceMale: e.target.value })
          }
          placeholder="e.g. 400 or 800-400-200"
          className="h-7 text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">
          Distance (F) — meters
        </Label>
        <Input
          value={movement.prescribedDistanceFemale}
          onChange={(e) =>
            onUpdate({ prescribedDistanceFemale: e.target.value })
          }
          placeholder="e.g. 320"
          className="h-7 text-xs"
        />
      </div>
    </div>
  );
}

function DurationFields({
  movement,
  onUpdate,
  showClearButton,
}: MovementInputProps & { showClearButton: boolean }) {
  return (
    <div className="space-y-1.5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            Duration (M)
          </Label>
          <DurationInput
            value={movement.prescribedDurationSecondsMale ?? ""}
            onChange={(v) =>
              onUpdate({ prescribedDurationSecondsMale: v })
            }
            placeholder=":30 or 1:30"
            className="h-7 text-xs"
            ariaLabel="Prescribed duration (male)"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            Duration (F)
          </Label>
          <DurationInput
            value={movement.prescribedDurationSecondsFemale ?? ""}
            onChange={(v) =>
              onUpdate({ prescribedDurationSecondsFemale: v })
            }
            placeholder=":30 or 1:30"
            className="h-7 text-xs"
            ariaLabel="Prescribed duration (female)"
          />
        </div>
      </div>
      {showClearButton && (
        <button
          type="button"
          onClick={() =>
            onUpdate({
              prescribedDurationSecondsMale: "",
              prescribedDurationSecondsFemale: "",
            })
          }
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <X className="size-3" />
          Remove time cap
        </button>
      )}
    </div>
  );
}

// Height inputs — gendered pair when the rx_defaults indicate a gendered
// split (e.g. Box Jump 24/20). Single non-gendered input when the defaults
// match (deficit pushup 4/4) — that's the cue that the movement's height
// is gender-agnostic.
function HeightInputs({
  movement,
  defaults,
  onUpdate,
}: MovementInputProps & { defaults: RxDefaults }) {
  const maleDefault = defaults.height_inches_male;
  const femaleDefault = defaults.height_inches_female;
  const gendered =
    maleDefault != null &&
    femaleDefault != null &&
    String(maleDefault) !== String(femaleDefault);

  if (!gendered) {
    // Single input — writes to both gendered columns so the existing
    // save path picks it up without a schema change.
    return (
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Height (in)</Label>
        <Input
          type="number"
          min={0}
          step="0.5"
          value={
            movement.prescribedHeightInchesMale ||
            movement.prescribedHeightInches
          }
          onChange={(e) =>
            onUpdate({
              prescribedHeightInchesMale: e.target.value,
              prescribedHeightInchesFemale: e.target.value,
            })
          }
          placeholder={
            maleDefault != null ? `e.g. ${maleDefault}` : "e.g. 4"
          }
          className="h-7 text-xs"
        />
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">
          Height (M) — in
        </Label>
        <Input
          type="number"
          min={0}
          step="0.5"
          value={movement.prescribedHeightInchesMale}
          onChange={(e) =>
            onUpdate({ prescribedHeightInchesMale: e.target.value })
          }
          placeholder={maleDefault != null ? `e.g. ${maleDefault}` : "e.g. 24"}
          className="h-7 text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">
          Height (F) — in
        </Label>
        <Input
          type="number"
          min={0}
          step="0.5"
          value={movement.prescribedHeightInchesFemale}
          onChange={(e) =>
            onUpdate({ prescribedHeightInchesFemale: e.target.value })
          }
          placeholder={
            femaleDefault != null ? `e.g. ${femaleDefault}` : "e.g. 20"
          }
          className="h-7 text-xs"
        />
      </div>
    </div>
  );
}

function TempoInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">
        Tempo (optional)
      </Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. 30X1, 21X1"
        className="h-7 text-xs"
      />
    </div>
  );
}

// Rest is a duration-typed movement whose gender split has no meaning —
// athletes just rest. We render a single input and mirror the value into
// both gendered columns on save so the existing API path persists it.
function RestDurationField({ movement, onUpdate }: MovementInputProps) {
  const value =
    movement.prescribedDurationSecondsMale ||
    movement.prescribedDurationSecondsFemale ||
    "";
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">Rest duration</Label>
      <DurationInput
        value={value}
        onChange={(v) =>
          onUpdate({
            prescribedDurationSecondsMale: v,
            prescribedDurationSecondsFemale: v,
          })
        }
        placeholder="e.g. 1:00 between rounds"
        className="h-7 text-xs"
        ariaLabel="Rest duration"
      />
    </div>
  );
}

// ============================================
// RepSchemeField
// ============================================
//
// Free-text rep input with a small parser feedback chip and an optional
// "Continue as ladder?" toggle for ascending arithmetic sequences. Parsing
// is purely visual here — the canonical parsed shape is computed
// server-side at write time.

interface RepSchemeFieldProps {
  value: string;
  onChange: (next: string) => void;
  promoteSequenceToLadder: boolean;
  onPromoteChange: (next: boolean) => void;
  workoutType?: WorkoutType;
  hasTimeCap?: boolean;
  onAddTimeCap?: () => void;
}

function RepSchemeField({
  value,
  onChange,
  promoteSequenceToLadder,
  onPromoteChange,
  workoutType,
  hasTimeCap,
  onAddTimeCap,
}: RepSchemeFieldProps) {
  const parsed = parseRepScheme(value);
  const promotable = !!(parsed && canPromoteSequenceToLadder(parsed));

  // If the input changes such that the toggle no longer applies (e.g. user
  // edits "3-6-9-12-15" to "3-6-7"), clear the saved intent so the form
  // doesn't carry a stale "promote" flag.
  useEffect(() => {
    if (!promotable && promoteSequenceToLadder) {
      onPromoteChange(false);
    }
  }, [promotable, promoteSequenceToLadder, onPromoteChange]);

  let chip: React.ReactNode = null;
  if (parsed) {
    if (parsed.kind === "fixed") {
      chip = `Fixed: ${parsed.reps}`;
    } else if (parsed.kind === "sequence") {
      chip =
        promotable && promoteSequenceToLadder
          ? `Ladder: ${ladderPreview(parsed.reps[0], parsed.reps[1] - parsed.reps[0])}`
          : `Sequence: ${parsed.reps.join(", ")}`;
    } else if (parsed.kind === "ladder") {
      chip = `Ladder: ${ladderPreview(parsed.start, parsed.step)}`;
    } else if (parsed.kind === "sets") {
      chip = `Sets: ${parsed.sets} × ${parsed.reps}`;
    }
  }

  const isForReps = workoutType === "for_reps";
  const repsLabel =
    workoutType === "for_load"
      ? "Rep Scheme"
      : isForReps
        ? "Reps (optional)"
        : "Reps";
  const repsPlaceholder =
    workoutType === "for_load"
      ? "e.g. 5-5-5-5-5, 10-10-7-7-3-3-3, 1RM"
      : isForReps
        ? "Optional — only set for prescribed movements"
        : "e.g. 21-15-9, 3-6-9-12..., 5x5, 15";

  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{repsLabel}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={repsPlaceholder}
        className="h-7 text-xs"
      />
      {isForReps && !value && (
        <p className="text-[11px] text-muted-foreground/70">
          Leave blank if this movement is scored. Set reps only for capped
          movements (e.g. &quot;10 T2B&quot; before a max-cal row).
        </p>
      )}
      {chip && (
        <p className="flex items-center gap-1 text-[11px] text-emerald-400">
          <Check className="size-3" />
          {chip}
        </p>
      )}
      {promotable && (
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={promoteSequenceToLadder}
            onChange={(e) => onPromoteChange(e.target.checked)}
            className="size-3 cursor-pointer"
          />
          Continue as ladder?
          {!promoteSequenceToLadder &&
            parsed?.kind === "sequence" &&
            parsed.reps.length >= 2 && (
              <span className="text-muted-foreground/70">
                Preview: {ladderPreview(parsed.reps[0], parsed.reps[1] - parsed.reps[0])}
              </span>
            )}
        </label>
      )}
      {!hasTimeCap && onAddTimeCap && workoutType !== "for_load" && (
        <button
          type="button"
          onClick={onAddTimeCap}
          className="inline-flex items-center gap-1 text-[11px] text-primary/80 hover:text-primary"
        >
          <Plus className="size-3" />
          Add time cap
        </button>
      )}
    </div>
  );
}

// ============================================
// Legacy helpers — name-pattern fallbacks used when rx_fields is empty.
// ============================================

const HEIGHT_BEARING_NAME = /^(box jump( over)?|box step-?up|step-?up|deficit (push-?up|hspu|handstand push-?up))$/i;

function isHeightBearing(name: string | undefined): boolean {
  if (!name) return false;
  return HEIGHT_BEARING_NAME.test(name.trim());
}

function isHeightDeficit(name: string | undefined): boolean {
  return !!name && /^deficit /i.test(name.trim());
}

function isLegacyRestMovement(m: WorkoutBuilderMovement): boolean {
  return (
    m.metricType === "duration" &&
    /^rest$/i.test((m.movementName ?? "").trim())
  );
}

// Render a few terms past the seed so the user sees the open-ended shape.
function ladderPreview(start: number, step: number, terms = 7): string {
  const out: number[] = [];
  for (let i = 0; i < terms; i++) out.push(start + i * step);
  return `${out.join(", ")}, …`;
}
