"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  ExternalLink,
  GripVertical,
  Loader2,
  MoveRight,
  Plus,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  WORKOUT_SECTION_KINDS,
  WORKOUT_SECTION_KIND_LABELS,
  type WorkoutSectionKind,
} from "@/db/schema";
import { AddWorkoutTabs } from "@/components/crossfit/add-workout-tabs";
import {
  benchmarkPartToBuilderPart,
  builderPartToPayload,
} from "@/lib/crossfit/builder-payload";
import { resolveParsedToCreatePart } from "@/lib/crossfit/resolve-parsed-movements";
import { useMovements, useCreateMovement } from "@/hooks/useMovements";
import {
  WORKOUT_TYPE_LABELS,
  type BenchmarkWorkout,
  type MovementMetricType,
  type ParsedWorkout,
  type WorkoutBuilderForm,
  type WorkoutType,
} from "@/types/crossfit";
import type { CreatePartInput } from "@/hooks/useWorkouts";
import { formatTime } from "@/lib/workout-parser";
import { formatSecondsAsClock } from "@/lib/crossfit/duration-parser";
import { formatMovementPrescription } from "@/lib/crossfit/prescription";
import { WorkoutPreviewDialog } from "./workout-preview-dialog";

// Per-movement wire shape — mirrors the API response from
// /api/gym/[id]/programming. Drives the inline section preview so coaches
// see the WOD's movements without opening Preview or Smart Builder.
interface MovementWire {
  id: string;
  movementName: string;
  metricType: string;
  orderIndex: number;
  workoutBlockId: string | null;
  prescribedReps: string | null;
  prescribedWeightMale: string | null;
  prescribedWeightFemale: string | null;
  prescribedCaloriesMale: string | null;
  prescribedCaloriesFemale: string | null;
  prescribedDistanceMale: string | null;
  prescribedDistanceFemale: string | null;
  prescribedDurationSecondsMale: number | null;
  prescribedDurationSecondsFemale: number | null;
  prescribedHeightInches: string | null;
  prescribedHeightInchesMale: string | null;
  prescribedHeightInchesFemale: string | null;
  prescribedWeightMaleBwMultiplier: string | null;
  prescribedWeightFemaleBwMultiplier: string | null;
  prescribedWeightPct: string | null;
  tempo: string | null;
  isMaxReps: boolean;
  isSideCadence: boolean;
  equipmentCount: number | null;
}

interface PartWire {
  id: string;
  label: string | null;
  orderIndex: number;
  notes: string | null;
  workoutType: string;
  timeCapSeconds: number | null;
  amrapDurationSeconds: number | null;
  emomIntervalSeconds: number | null;
  intervalWorkSeconds: number | null;
  intervalRestSeconds: number | null;
  intervalRounds: unknown;
  sideCadenceIntervalSeconds: number | null;
  sideCadenceOpenEnded: boolean;
  repScheme: string | null;
  rounds: number | null;
  structure: string | null;
  blocks: { id: string; orderIndex: number; title: string }[];
  movements: MovementWire[];
}

interface SectionWire {
  id: string;
  kind: WorkoutSectionKind;
  position: number;
  title: string | null;
  body?: string | null;
  isScored: boolean;
  scoreType: string | null;
  reviewedAt: string | null;
  parts: PartWire[];
}

interface WorkoutWire {
  id: string;
  title: string | null;
  workoutDate: string;
  sections: SectionWire[];
  partsWithoutSection: PartWire[];
}

interface Props {
  communityId: string;
  date: string;
  workout: WorkoutWire | null;
  // Workouts on the same date that weren't programmed (added manually
  // from the CrossFit tab — programming_release_id is null). Rendered
  // as a banner so the coach knows they exist without conflating them
  // with the programmed sections.
  manualWorkouts?: WorkoutWire[];
  onMutated: () => void;
}

// Sections that get scaffolded as placeholders on every day. Coaches
// can fill them in (POSTs a real section on first edit) or dismiss the
// X to hide the placeholder for that day. Hidden state is local and
// persisted to localStorage so a refresh doesn't bring it back.
const STANDARD_SECTION_KINDS: WorkoutSectionKind[] = [
  "warm_up",
  "pre_skill",
  "wod",
  "post_skill",
  "stretching",
];

// Section kinds that never get scored and don't benefit from movement-level
// parts. These render as an always-editable, blur-saved freeform textarea
// directly on the card — no Smart Builder, no workout-type picker. Other
// kinds (WOD, skill work) keep the Build/Edit dialog path.
const FREEFORM_SECTION_KINDS: readonly WorkoutSectionKind[] = [
  "warm_up",
  "stretching",
];

function isFreeformKind(kind: WorkoutSectionKind): boolean {
  return (FREEFORM_SECTION_KINDS as readonly string[]).includes(kind);
}

// Default title coaches see pre-filled when a warm-up / stretching
// placeholder is converted to a real section. Editable afterward.
function defaultFreeformTitle(kind: WorkoutSectionKind): string | null {
  if (kind === "warm_up") return "Dynamic Warm-Up";
  if (kind === "stretching") return "Cool-Down & Stretching";
  return null;
}

function hiddenStorageKey(communityId: string, date: string): string {
  return `gym:${communityId}:programming:${date}:hiddenPlaceholders`;
}

function readHiddenKinds(communityId: string, date: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(
      hiddenStorageKey(communityId, date)
    );
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

function writeHiddenKinds(
  communityId: string,
  date: string,
  kinds: Set<string>
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      hiddenStorageKey(communityId, date),
      JSON.stringify(Array.from(kinds))
    );
  } catch {
    // Storage is best-effort; ignore quota errors.
  }
}

function formatHeader(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function ProgrammingDayCard({
  communityId,
  date,
  workout,
  manualWorkouts = [],
  onMutated,
}: Props) {
  const [expanded, setExpanded] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newKind, setNewKind] = useState<WorkoutSectionKind>("custom");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deletingDay, setDeletingDay] = useState(false);
  const [hiddenPlaceholders, setHiddenPlaceholders] = useState<Set<string>>(
    () => new Set()
  );

  // Load persisted "hidden placeholder" state on mount. Lives in
  // localStorage so dismissing e.g. "Stretching" on a single day
  // survives page reloads, but isn't shared across devices.
  useEffect(() => {
    setHiddenPlaceholders(readHiddenKinds(communityId, date));
  }, [communityId, date]);

  const sortedSections = useMemo(
    () => [...(workout?.sections ?? [])].sort((a, b) => a.position - b.position),
    [workout]
  );

  // Local copy of the section order, updated optimistically on drag end
  // so the row visually settles into its new spot before the bulk PATCH
  // returns. React Query refetches the canonical order on success.
  const [localOrder, setLocalOrder] = useState<SectionWire[]>(sortedSections);
  useEffect(() => {
    setLocalOrder(sortedSections);
  }, [sortedSections]);

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
      if (!over || active.id === over.id) return;
      const oldIdx = localOrder.findIndex((s) => s.id === active.id);
      const newIdx = localOrder.findIndex((s) => s.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return;
      const next = arrayMove(localOrder, oldIdx, newIdx);
      setLocalOrder(next);
      if (!workout) return;
      const orderedIds = next.map((s) => s.id);
      void fetch(`/api/gym/${communityId}/programming/sections/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: workout.id, orderedSectionIds: orderedIds }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error(body?.error ?? "Failed to reorder");
          }
          onMutated();
        })
        .catch((err) => {
          toast.error(err instanceof Error ? err.message : "Failed to reorder");
          // Snap back to the canonical order from the parent's query data.
          setLocalOrder(sortedSections);
        });
    },
    [localOrder, sortedSections, workout, communityId, onMutated]
  );

  // Standard kinds that aren't yet a real section AND haven't been
  // dismissed. Each becomes a clickable placeholder card.
  const placeholderKinds = useMemo(() => {
    const present = new Set(localOrder.map((s) => s.kind));
    return STANDARD_SECTION_KINDS.filter(
      (k) => !present.has(k) && !hiddenPlaceholders.has(k)
    );
  }, [localOrder, hiddenPlaceholders]);

  function dismissPlaceholder(kind: WorkoutSectionKind) {
    setHiddenPlaceholders((prev) => {
      const next = new Set(prev);
      next.add(kind);
      writeHiddenKinds(communityId, date, next);
      return next;
    });
  }

  async function createSection(
    kind: WorkoutSectionKind,
    opts?: { silent?: boolean; body?: string | null; title?: string | null }
  ): Promise<{ id: string } | null> {
    try {
      const payload: Record<string, unknown> = workout
        ? { workoutId: workout.id, kind }
        : { workoutDate: date, kind };
      if (opts?.body !== undefined) payload.body = opts.body;
      if (opts?.title !== undefined) payload.title = opts.title;
      const res = await fetch(
        `/api/gym/${communityId}/programming/sections`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to add section");
      }
      const created = (await res.json().catch(() => null)) as
        | { id: string }
        | null;
      if (!opts?.silent) toast.success("Section added");
      onMutated();
      return created;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
      return null;
    }
  }

  async function addSection() {
    setAdding(true);
    try {
      await createSection(newKind);
    } finally {
      setAdding(false);
    }
  }

  // Wipes the programmed workout for this day (sections + parts + scores
  // cascade). Manual workouts on the same date live on separate rows and
  // are untouched.
  async function deleteDay() {
    if (!workout) return;
    if (
      !confirm(
        "Delete this day's programming? All sections and any athlete scores for this day will be removed. Manual workouts on the same date are kept. This cannot be undone."
      )
    ) {
      return;
    }
    setDeletingDay(true);
    try {
      const res = await fetch(
        `/api/workouts/${workout.id}?programmingOnly=1`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to delete day");
      }
      toast.success("Day deleted");
      onMutated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setDeletingDay(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 text-left"
        >
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-sm font-bold">{formatHeader(date)}</span>
          {sortedSections.length === 0 ? (
            <span className="ml-2 text-[10px] text-muted-foreground">
              empty
            </span>
          ) : (
            <span className="ml-2 text-[10px] text-muted-foreground">
              {sortedSections.length} sections
            </span>
          )}
        </button>
        <div className="flex items-center gap-1">
          {workout && sortedSections.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPreviewOpen(true)}
              className="gap-1.5"
              title="See how athletes will view this day"
            >
              <Eye className="h-3.5 w-3.5" />
              Preview
            </Button>
          ) : null}
          {workout ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={deleteDay}
              disabled={deletingDay}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              title="Delete this day's programming. Manual workouts on this date are kept."
            >
              {deletingDay ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <WorkoutPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        workoutId={workout?.id ?? null}
        dateLabel={formatHeader(date)}
      />
      {expanded ? (
        <CardContent className="space-y-2">
          {manualWorkouts.length > 0 ? (
            <ManualWorkoutBanner
              communityId={communityId}
              date={date}
              workouts={manualWorkouts}
              onMutated={onMutated}
            />
          ) : null}
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <SortableContext
              items={localOrder.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              {localOrder.map((s) => (
                <SortableSectionRow
                  key={s.id}
                  communityId={communityId}
                  section={s}
                  onMutated={onMutated}
                />
              ))}
            </SortableContext>
          </DndContext>
          {placeholderKinds.map((kind) =>
            isFreeformKind(kind) ? (
              <FreeformPlaceholderRow
                key={`placeholder-${kind}`}
                kind={kind}
                onCreateWithBody={(bodyText) =>
                  createSection(kind, {
                    silent: true,
                    body: bodyText,
                    title: defaultFreeformTitle(kind),
                  })
                }
                onDismiss={() => dismissPlaceholder(kind)}
              />
            ) : (
              <PlaceholderSectionRow
                key={`placeholder-${kind}`}
                kind={kind}
                onCreate={() => createSection(kind)}
                onDismiss={() => dismissPlaceholder(kind)}
              />
            )
          )}
          {/* The 5 standard kinds are already scaffolded above. This
              dropdown is only useful for adding the less common kinds
              (custom, at_home, monthly_challenge) — filter the standard
              ones out so coaches aren't tempted to double-add a WOD. */}
          <div className="flex items-end gap-2 pt-2">
            <div className="flex-1 space-y-1">
              <Label className="text-[10px] text-muted-foreground">
                Add another section
              </Label>
              <Select
                value={newKind}
                items={WORKOUT_SECTION_KIND_LABELS}
                onValueChange={(v) => setNewKind(v as WorkoutSectionKind)}
              >
                <SelectTrigger className="h-8 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORKOUT_SECTION_KINDS.filter(
                    (k) =>
                      !(STANDARD_SECTION_KINDS as readonly string[]).includes(k)
                  ).map((k) => (
                    <SelectItem key={k} value={k}>
                      {WORKOUT_SECTION_KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={addSection} disabled={adding}>
              {adding ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Add
            </Button>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}

interface SectionRowProps {
  communityId: string;
  section: SectionWire;
  onMutated: () => void;
  dragListeners?: Record<string, unknown>;
}

// Sortable wrapper that routes between freeform and built rows while
// hooking each into the parent's DnD context. Keeps the row components
// themselves unaware of dnd-kit internals.
function SortableSectionRow({
  communityId,
  section,
  onMutated,
}: SectionRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {isFreeformKind(section.kind) ? (
        <FreeformSectionRow
          communityId={communityId}
          section={section}
          onMutated={onMutated}
          dragListeners={listeners}
        />
      ) : (
        <SectionRow
          communityId={communityId}
          section={section}
          onMutated={onMutated}
          dragListeners={listeners}
        />
      )}
    </div>
  );
}

function DragHandle({
  listeners,
}: {
  listeners?: Record<string, unknown>;
}) {
  return (
    <button
      type="button"
      {...(listeners ?? {})}
      className="shrink-0 touch-none cursor-grab active:cursor-grabbing rounded p-0.5 -ml-0.5 text-muted-foreground/60 hover:bg-white/[0.05] hover:text-foreground"
      aria-label="Drag to reorder section"
    >
      <GripVertical className="size-3.5" />
    </button>
  );
}

function SectionRow({
  communityId,
  section,
  onMutated,
  dragListeners,
}: SectionRowProps) {
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<WorkoutSectionKind>(section.kind);
  const [title, setTitle] = useState(section.title ?? "");
  const [bodyText, setBodyText] = useState(section.body ?? "");
  const [saving, setSaving] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderSaving, setBuilderSaving] = useState(false);
  const [builderError, setBuilderError] = useState<string | null>(null);

  // Library + auto-create are needed by the Paste tab to resolve movement
  // names to ids. React Query caches both per-component, so calling these
  // hooks here doesn't refetch when multiple rows mount.
  const { data: movementLibrary = [] } = useMovements();
  const createMovement = useCreateMovement();

  // Single write path used by all three tabs. Section title gets
  // overwritten only when the caller passes one (e.g. Smart Builder
  // title, parsed workout title, benchmark name) — passing `null`
  // explicitly clears the title.
  const saveSectionContent = useCallback(
    async (input: {
      parts: CreatePartInput[];
      title?: string | null;
      notes?: string | null;
      successMessage?: string;
    }) => {
      if (input.parts.length === 0) {
        setBuilderError("Add at least one part with movements.");
        return;
      }
      setBuilderError(null);
      setBuilderSaving(true);
      try {
        const payload: {
          parts: CreatePartInput[];
          title?: string | null;
          notes?: string | null;
        } = { parts: input.parts };
        if (input.title !== undefined) {
          const trimmed = input.title?.trim();
          payload.title = trimmed ? trimmed : null;
        }
        if (input.notes !== undefined) {
          const trimmed = input.notes?.trim();
          payload.notes = trimmed ? input.notes : null;
        }
        const res = await fetch(
          `/api/gym/${communityId}/programming/sections/${section.id}/content`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? "Failed to save");
        }
        toast.success(input.successMessage ?? "Content saved");
        setBuilderOpen(false);
        onMutated();
      } catch (err) {
        setBuilderError(
          err instanceof Error ? err.message : "Failed to save content"
        );
      } finally {
        setBuilderSaving(false);
      }
    },
    [communityId, section.id, onMutated]
  );

  const handleBuilderSave = useCallback(
    async (form: WorkoutBuilderForm) => {
      const parts = form.parts
        .map(builderPartToPayload)
        .filter((p): p is CreatePartInput => p !== null);
      // Forward the Smart Builder title onto the section so members see
      // the WOD name (e.g. "Cindy") next to the WOD pill. Only forward
      // when non-empty — passing undefined preserves the section's
      // current title (an admin may have typed one in the inline editor).
      const trimmedTitle = form.title?.trim() ?? "";
      // Smart Builder's "Notes" field lives on `form.description`. Always
      // forward (including empty) so clearing the field in the UI clears
      // it on the section.
      await saveSectionContent({
        parts,
        title: trimmedTitle ? trimmedTitle : undefined,
        notes: form.description ?? "",
      });
    },
    [saveSectionContent]
  );

  const handleParserSave = useCallback(
    async (parsed: ParsedWorkout) => {
      const resolved = await resolveParsedToCreatePart(parsed, {
        movementLibrary,
        createMovement: (input) => createMovement.mutateAsync(input),
      });
      if (!resolved) {
        setBuilderError(
          "Couldn't resolve any movements. Try the Smart Builder."
        );
        return;
      }
      await saveSectionContent({
        parts: [resolved.part],
        title: parsed.title ?? undefined,
        notes: parsed.description ?? "",
      });
    },
    [movementLibrary, createMovement, saveSectionContent]
  );

  const handleBenchmarkSave = useCallback(
    async (benchmark: BenchmarkWorkout) => {
      // Run the benchmark's parts through the same form→payload pipeline
      // the user-facing benchmark form uses, so section content matches
      // what users see when they pick the same benchmark from the
      // CrossFit tab.
      const parts = benchmark.parts
        .map((p) => builderPartToPayload(benchmarkPartToBuilderPart(p)))
        .filter((p): p is CreatePartInput => p !== null);
      await saveSectionContent({
        parts,
        title: benchmark.name,
        notes: benchmark.description ?? "",
        successMessage: `Added ${benchmark.name}`,
      });
    },
    [saveSectionContent]
  );

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/gym/${communityId}/programming/sections`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: section.id,
            kind,
            title: title || null,
            body: bodyText || null,
          }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to save");
      }
      toast.success("Saved");
      setEditing(false);
      onMutated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this section? Parts will be moved out of the section.")) return;
    try {
      const res = await fetch(
        `/api/gym/${communityId}/programming/sections?id=${section.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed");
      }
      toast.success("Removed");
      onMutated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  // Warm-up / stretching routing now happens in SortableSectionRow, which
  // selects FreeformSectionRow vs SectionRow before either is rendered.

  if (!editing) {
    const hasContent =
      section.parts.length > 0 || !!section.body?.trim();
    return (
      <>
        <div className="flex items-start justify-between gap-2 rounded-md border border-border/60 bg-muted/10 px-2.5 py-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <DragHandle listeners={dragListeners} />
              <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
                {WORKOUT_SECTION_KIND_LABELS[section.kind]}
              </span>
              {section.title ? (
                <span className="ml-1 truncate text-xs text-muted-foreground">
                  {section.title}
                </span>
              ) : null}
            </div>
            {section.body?.trim() ? (
              <p className="mt-1.5 whitespace-pre-wrap text-[11px] text-muted-foreground line-clamp-3">
                {section.body}
              </p>
            ) : null}
            {section.parts.length > 0 ? (
              <SectionPartsPreview parts={section.parts} />
            ) : null}
            <div className="mt-1 text-[11px] text-muted-foreground">
              {section.parts.length === 0 && !section.body?.trim()
                ? "Empty — add content"
                : `${section.parts.length} ${
                    section.parts.length === 1 ? "part" : "parts"
                  }${section.reviewedAt ? " · reviewed" : ""}`}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Button
              size="sm"
              variant={hasContent ? "ghost" : "default"}
              onClick={() => {
                setBuilderError(null);
                setBuilderOpen(true);
              }}
              className="gap-1.5"
              title="Compose movements with the Smart Builder"
            >
              <Wrench className="h-3.5 w-3.5" />
              Build
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={remove}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <Dialog open={builderOpen} onOpenChange={setBuilderOpen}>
          <DialogContent className="max-h-[90vh] w-[min(96vw,42rem)] max-w-none overflow-x-hidden overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                Build {WORKOUT_SECTION_KIND_LABELS[section.kind]} content
              </DialogTitle>
            </DialogHeader>
            {builderError ? (
              <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {builderError}
              </p>
            ) : null}
            {builderSaving ? (
              <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                Saving…
              </div>
            ) : null}
            <AddWorkoutTabs
              onSaveFromBuilder={handleBuilderSave}
              onSaveFromParser={handleParserSave}
              onSaveFromBenchmark={handleBenchmarkSave}
              onCancel={() => setBuilderOpen(false)}
              builderSaveLabel="Save content"
              parserSaveLabel="Save content"
              benchmarkSubmitLabel="Add to section"
              isBenchmarkSubmitting={builderSaving}
              lockedDate
              hidePartner
              hideVest
            />
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-primary/40 bg-primary/[0.04] px-2.5 py-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Kind</Label>
          <Select
            value={kind}
            items={WORKOUT_SECTION_KIND_LABELS}
            onValueChange={(v) => setKind(v as WorkoutSectionKind)}
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WORKOUT_SECTION_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {WORKOUT_SECTION_KIND_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Title (optional)</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-8"
            placeholder="Snatch Skill"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">
          Prescription (freeform — for warm-ups, stretching, etc.)
        </Label>
        <Textarea
          rows={3}
          value={bodyText}
          onChange={(e) => setBodyText(e.target.value)}
          placeholder="3 rounds: 10 air squats, 10 push-ups, 200m row"
          className="text-xs"
        />
        <p className="text-[10px] text-muted-foreground">
          Use this for sections that don&apos;t need movement-level scoring.
          For scored WODs and skill work, click <strong>Build</strong> to
          open the Smart Builder.
        </p>
      </div>
      <p className="rounded-md border border-border/60 bg-muted/20 px-2 py-1.5 text-[10px] text-muted-foreground">
        Scoring is configured per-part in the Smart Builder. Click{" "}
        <strong>Build</strong> from the section row to set score types.
      </p>
      <div className="flex justify-end gap-2 pt-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setEditing(false)}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
        </Button>
      </div>
    </div>
  );
}

interface PlaceholderRowProps {
  kind: WorkoutSectionKind;
  onCreate: () => Promise<{ id: string } | null>;
  onDismiss: () => void;
}

// Placeholder card for a standard section kind that doesn't yet exist
// for this day. Looks intentionally muted so it's clear it's a stub
// the coach can either fill in or dismiss. Clicking either action
// button POSTs the real section first, then the underlying list
// re-renders from the refetch with a real SectionRow in this slot.
function PlaceholderSectionRow({
  kind,
  onCreate,
  onDismiss,
}: PlaceholderRowProps) {
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    setCreating(true);
    try {
      await onCreate();
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-border/60 bg-muted/5 px-2.5 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
          {WORKOUT_SECTION_KIND_LABELS[kind]}
        </span>
        <span className="truncate text-[11px] text-muted-foreground">
          Not yet added — click to fill in
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={handleCreate}
          disabled={creating}
          className="gap-1.5"
          title={`Add a ${WORKOUT_SECTION_KIND_LABELS[kind]} section`}
        >
          {creating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Add
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDismiss}
          title="Hide this placeholder for this day (won't affect other days)"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

interface FreeformSectionRowProps {
  communityId: string;
  section: SectionWire;
  onMutated: () => void;
  dragListeners?: Record<string, unknown>;
}

// Inline editor for warm-up / stretching sections. The body textarea is
// always visible and auto-saves on blur via PATCH. No Build button, no
// workout-type picker — these sections are never scored.
function FreeformSectionRow({
  communityId,
  section,
  onMutated,
  dragListeners,
}: FreeformSectionRowProps) {
  const [title, setTitle] = useState(section.title ?? "");
  const [bodyText, setBodyText] = useState(section.body ?? "");
  const [savedTitle, setSavedTitle] = useState(section.title ?? "");
  const [savedBody, setSavedBody] = useState(section.body ?? "");
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  const persist = useCallback(
    async (nextTitle: string, nextBody: string) => {
      setSaving(true);
      try {
        const res = await fetch(
          `/api/gym/${communityId}/programming/sections`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: section.id,
              title: nextTitle.trim() || null,
              body: nextBody.trim() || null,
            }),
          }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? "Failed to save");
        }
        setSavedTitle(nextTitle);
        setSavedBody(nextBody);
        setJustSaved(true);
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setJustSaved(false), 1500);
        onMutated();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed");
      } finally {
        setSaving(false);
      }
    },
    [communityId, section.id, onMutated]
  );

  function maybeSave(nextTitle: string, nextBody: string) {
    if (nextTitle === savedTitle && nextBody === savedBody) return;
    void persist(nextTitle, nextBody);
  }

  async function remove() {
    if (!confirm("Delete this section?")) return;
    try {
      const res = await fetch(
        `/api/gym/${communityId}/programming/sections?id=${section.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed");
      }
      toast.success("Removed");
      onMutated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/10 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <DragHandle listeners={dragListeners} />
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
            {WORKOUT_SECTION_KIND_LABELS[section.kind]}
          </span>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => maybeSave(title, bodyText)}
            className="h-7 flex-1 border-transparent bg-transparent px-1.5 text-xs focus-visible:border-input focus-visible:bg-background"
            placeholder="Title (optional)"
          />
        </div>
        <div className="flex items-center gap-1">
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          ) : justSaved ? (
            <Check className="h-3.5 w-3.5 text-emerald-500" />
          ) : null}
          <Button size="sm" variant="ghost" onClick={remove} title="Delete section">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <Textarea
        rows={3}
        value={bodyText}
        onChange={(e) => setBodyText(e.target.value)}
        onBlur={() => maybeSave(title, bodyText)}
        placeholder={
          section.kind === "warm_up"
            ? "Type or paste your warm-up. E.g. 3 rounds: 10 air squats, 10 push-ups, 200m row"
            : "Type or paste your cool-down / stretching routine."
        }
        className="text-xs"
      />
    </div>
  );
}

interface FreeformPlaceholderRowProps {
  kind: WorkoutSectionKind;
  onCreateWithBody: (body: string) => Promise<{ id: string } | null>;
  onDismiss: () => void;
}

// Placeholder for warm-up / stretching that's already an inline textarea —
// no "Add" click required. On blur with non-empty content we POST the
// section with body in one shot, then onMutated refetches and swaps this
// for a real FreeformSectionRow.
function FreeformPlaceholderRow({
  kind,
  onCreateWithBody,
  onDismiss,
}: FreeformPlaceholderRowProps) {
  const [bodyText, setBodyText] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleBlur() {
    const trimmed = bodyText.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      await onCreateWithBody(trimmed);
      // Parent re-renders and replaces us with a real FreeformSectionRow.
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-1.5 rounded-md border border-dashed border-border/60 bg-muted/5 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
          {WORKOUT_SECTION_KIND_LABELS[kind]}
        </span>
        <div className="flex items-center gap-1">
          {creating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={onDismiss}
            title="Hide this placeholder for this day (won't affect other days)"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <Textarea
        rows={3}
        value={bodyText}
        onChange={(e) => setBodyText(e.target.value)}
        onBlur={handleBlur}
        placeholder={
          kind === "warm_up"
            ? "Type or paste your warm-up here — saves when you click away."
            : "Type or paste your cool-down / stretching routine — saves when you click away."
        }
        className="text-xs"
        disabled={creating}
      />
    </div>
  );
}

interface ManualWorkoutBannerProps {
  communityId: string;
  date: string;
  workouts: { id: string; title: string | null }[];
  onMutated: () => void;
}

// Surfaces any workouts on this date that were added manually from the
// CrossFit tab (no programming_release_id). The coach can either edit
// them on the CrossFit tab or move them straight into programming as a
// new section of the chosen kind.
function ManualWorkoutBanner({
  communityId,
  date,
  workouts,
  onMutated,
}: ManualWorkoutBannerProps) {
  const [movingId, setMovingId] = useState<string | null>(null);

  return (
    <div className="space-y-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-2 text-[11px] text-amber-300">
      <div className="flex items-center gap-2">
        <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="flex-1">
          {workouts.length}{" "}
          {workouts.length === 1 ? "manual workout" : "manual workouts"} on
          this day
        </span>
        <Link
          href={`/crossfit?date=${date}`}
          className="text-[10px] uppercase text-amber-300/70 hover:text-amber-300"
        >
          Edit on CrossFit tab
        </Link>
      </div>
      <ul className="space-y-1">
        {workouts.map((w) => (
          <li
            key={w.id}
            className="flex items-center gap-2 rounded border border-amber-500/20 bg-amber-500/[0.04] px-2 py-1"
          >
            <span className="min-w-0 flex-1 truncate text-[11px] text-amber-100">
              {w.title?.trim() ? w.title : "Untitled workout"}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 px-1.5 text-[10px] text-amber-200 hover:bg-amber-500/15 hover:text-amber-100"
              onClick={() => setMovingId(w.id)}
              title="Move this workout into the day's programming as a new section"
            >
              <MoveRight className="h-3 w-3" />
              Move into programming
            </Button>
          </li>
        ))}
      </ul>
      <MoveWorkoutDialog
        communityId={communityId}
        date={date}
        sourceWorkout={
          movingId
            ? workouts.find((w) => w.id === movingId) ?? null
            : null
        }
        open={!!movingId}
        onOpenChange={(open) => {
          if (!open) setMovingId(null);
        }}
        onMoved={() => {
          setMovingId(null);
          onMutated();
        }}
      />
    </div>
  );
}

interface MoveWorkoutDialogProps {
  communityId: string;
  date: string;
  sourceWorkout: { id: string; title: string | null } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMoved: () => void;
}

// Kinds the coach can move a manual workout into. Warm-up and stretching
// are freeform-only — moving structured parts into them would require
// flattening the parts to body text, which isn't worth the complexity.
const MOVE_TARGET_KINDS: WorkoutSectionKind[] = [
  "wod",
  "pre_skill",
  "post_skill",
  "custom",
];

function MoveWorkoutDialog({
  communityId,
  date,
  sourceWorkout,
  open,
  onOpenChange,
  onMoved,
}: MoveWorkoutDialogProps) {
  const [kind, setKind] = useState<WorkoutSectionKind>("wod");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!sourceWorkout) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/gym/${communityId}/programming/sections/from-workout`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceWorkoutId: sourceWorkout.id,
            kind,
            workoutDate: date,
          }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to move");
      }
      toast.success("Moved into programming");
      onMoved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,28rem)]">
        <DialogHeader>
          <DialogTitle>Move into programming</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Moving{" "}
            <span className="font-medium text-foreground">
              {sourceWorkout?.title?.trim() ?? "this workout"}
            </span>{" "}
            into the day&apos;s programming as a new section. The workout
            will be removed from the CrossFit tab.
          </p>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">
              Section kind
            </Label>
            <Select
              value={kind}
              items={WORKOUT_SECTION_KIND_LABELS}
              onValueChange={(v) => setKind(v as WorkoutSectionKind)}
            >
              <SelectTrigger className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MOVE_TARGET_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {WORKOUT_SECTION_KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={submitting}>
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <MoveRight className="h-3.5 w-3.5" />
            )}
            Move
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Inline structured-section preview
// ============================================================

// Compact read-only render of a scored section's parts so the coach sees
// movements/reps/weights inline in the day card. Mirrors the athlete-facing
// rendering closely enough to function as a WYSIWYG check without opening
// the Preview dialog. Per-movement strings flow through the same
// `formatMovementPrescription` helper the athlete card uses, so drift
// between admin and member views is minimized.
function SectionPartsPreview({ parts }: { parts: PartWire[] }) {
  const sortedParts = [...parts].sort((a, b) => a.orderIndex - b.orderIndex);
  const showPartLabels = sortedParts.length > 1;
  return (
    <div className="mt-2 space-y-2">
      {sortedParts.map((part, idx) => (
        <PartPreview
          key={part.id}
          part={part}
          index={idx}
          showLabel={showPartLabels}
        />
      ))}
    </div>
  );
}

function PartPreview({
  part,
  index,
  showLabel,
}: {
  part: PartWire;
  index: number;
  showLabel: boolean;
}) {
  const workoutType = part.workoutType as WorkoutType;
  const typeLabel = WORKOUT_TYPE_LABELS[workoutType] ?? part.workoutType;
  const signature = signatureFor(part);
  const cap =
    part.timeCapSeconds && part.workoutType !== "amrap"
      ? `cap ${formatTime(part.timeCapSeconds)}`
      : null;
  // Defensive nullish-coalesce: the persisted React Query cache may briefly
  // restore a pre-PartWire response shape on first paint after the API was
  // extended, leaving `movements`/`blocks` undefined until the refetch
  // lands. See [[project_hydration_persisted_cache]].
  const sortedMovements = [...(part.movements ?? [])].sort(
    (a, b) => a.orderIndex - b.orderIndex
  );
  const isComplex = part.structure === "complex";
  const defaultLabel = `Part ${String.fromCharCode(65 + index)}`;

  return (
    <div className="rounded border border-border/40 bg-background/40 px-2 py-1.5">
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground">
        {showLabel ? (
          <span className="font-semibold uppercase tracking-wide text-foreground/80">
            {part.label || defaultLabel}
          </span>
        ) : null}
        <span className="font-semibold uppercase tracking-wide text-primary/90">
          {typeLabel}
        </span>
        {signature ? (
          <span className="font-mono font-bold text-foreground/90">
            {signature}
          </span>
        ) : null}
        {cap ? <span>· {cap}</span> : null}
      </div>
      {sortedMovements.length > 0 ? (
        <div className="mt-1 space-y-0.5 text-[11px] text-foreground/85">
          {isComplex ? (
            <ComplexMovementLine movements={sortedMovements} />
          ) : (
            <MovementsByBlock part={part} movements={sortedMovements} />
          )}
        </div>
      ) : null}
    </div>
  );
}

function MovementsByBlock({
  part,
  movements,
}: {
  part: PartWire;
  movements: MovementWire[];
}) {
  const ungrouped = movements.filter((m) => !m.workoutBlockId);
  const byBlock = new Map<string, MovementWire[]>();
  for (const m of movements) {
    if (!m.workoutBlockId) continue;
    const list = byBlock.get(m.workoutBlockId) ?? [];
    list.push(m);
    byBlock.set(m.workoutBlockId, list);
  }
  const orderedBlocks = [...(part.blocks ?? [])].sort(
    (a, b) => a.orderIndex - b.orderIndex
  );
  return (
    <>
      {ungrouped.map((m) => (
        <MovementLine key={m.id} mov={m} />
      ))}
      {orderedBlocks.map((b) => {
        const blockMovements = byBlock.get(b.id) ?? [];
        if (blockMovements.length === 0) return null;
        return (
          <div key={b.id} className="pt-0.5">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {b.title}
            </div>
            {blockMovements.map((m) => (
              <MovementLine key={m.id} mov={m} />
            ))}
          </div>
        );
      })}
    </>
  );
}

function MovementLine({ mov }: { mov: MovementWire }) {
  const details = formatMovementPrescription(
    {
      movementName: mov.movementName,
      metricType: mov.metricType as MovementMetricType,
      prescribedReps: mov.prescribedReps,
      prescribedWeightMale: mov.prescribedWeightMale,
      prescribedWeightFemale: mov.prescribedWeightFemale,
      prescribedCaloriesMale: mov.prescribedCaloriesMale,
      prescribedCaloriesFemale: mov.prescribedCaloriesFemale,
      prescribedDistanceMale: mov.prescribedDistanceMale,
      prescribedDistanceFemale: mov.prescribedDistanceFemale,
      prescribedDurationSecondsMale: mov.prescribedDurationSecondsMale,
      prescribedDurationSecondsFemale: mov.prescribedDurationSecondsFemale,
      prescribedHeightInches: mov.prescribedHeightInches,
      prescribedHeightInchesMale: mov.prescribedHeightInchesMale,
      prescribedHeightInchesFemale: mov.prescribedHeightInchesFemale,
      prescribedWeightMaleBwMultiplier: mov.prescribedWeightMaleBwMultiplier,
      prescribedWeightFemaleBwMultiplier:
        mov.prescribedWeightFemaleBwMultiplier,
      prescribedWeightPct: mov.prescribedWeightPct,
      tempo: mov.tempo,
      equipmentCount: mov.equipmentCount,
    },
    null,
    null
  );
  // The signature line already shows the rep scheme for rep-scheme parts —
  // drop the duplicate from per-movement details so we don't render
  // "21-15-9 Thrusters (21-15-9 · 95/65 lb)".
  const reps = (mov.prescribedReps ?? "").trim();
  const detailWithoutReps = (() => {
    if (!details) return "";
    if (!reps) return details;
    if (details === reps) return "";
    if (details.startsWith(`${reps} · `)) {
      return details.slice(`${reps} · `.length);
    }
    return details;
  })();
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-muted-foreground/70">·</span>
      {mov.isMaxReps ? (
        <span className="font-mono font-semibold text-amber-300/90">MAX</span>
      ) : reps ? (
        <span className="font-mono font-semibold text-foreground/90">
          {reps}
        </span>
      ) : null}
      <span className="text-foreground/85">{mov.movementName}</span>
      {detailWithoutReps ? (
        <span className="text-muted-foreground/85">({detailWithoutReps})</span>
      ) : null}
      {mov.isSideCadence ? (
        <span className="text-[9px] uppercase tracking-wide text-cyan-300/80">
          side cadence
        </span>
      ) : null}
    </div>
  );
}

function ComplexMovementLine({ movements }: { movements: MovementWire[] }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
      <span className="text-muted-foreground/70">·</span>
      {movements.map((m, i) => (
        <span key={m.id} className="flex items-baseline gap-1.5">
          {i > 0 ? (
            <span className="text-muted-foreground/70">+</span>
          ) : null}
          {m.prescribedReps ? (
            <span className="font-mono font-semibold text-foreground/90">
              {m.prescribedReps}
            </span>
          ) : null}
          <span className="text-foreground/85">{m.movementName}</span>
        </span>
      ))}
      <span className="text-[10px] text-muted-foreground/80">
        — unbroken
      </span>
    </div>
  );
}

// Mirror of PartSection's "signature" derivation in workout-card.tsx,
// trimmed to a single-line string for the compact admin preview. Returns
// null when the part has nothing structural worth surfacing beyond its
// type label (so the header line stays clean).
function signatureFor(part: PartWire): string | null {
  if (part.workoutType === "tabata" || part.structure === "tabata") {
    return "8 × :20 / :10";
  }
  if (part.workoutType === "intervals") {
    if (Array.isArray(part.intervalRounds) && part.intervalRounds.length > 0) {
      return (part.intervalRounds as Array<{
        workSeconds: number;
        restSeconds: number;
      }>)
        .map(
          (r) =>
            `${formatSecondsAsClock(r.workSeconds)} / ${formatSecondsAsClock(r.restSeconds)}`
        )
        .join(" → ");
    }
    const work =
      part.intervalWorkSeconds != null
        ? formatSecondsAsClock(part.intervalWorkSeconds)
        : null;
    const rest =
      part.intervalRestSeconds != null
        ? formatSecondsAsClock(part.intervalRestSeconds)
        : null;
    const roundsLabel = part.rounds
      ? `${part.rounds} ${part.rounds === 1 ? "round" : "rounds"}`
      : null;
    const cadence = [work ? `${work} work` : null, rest ? `${rest} rest` : null]
      .filter(Boolean)
      .join(" / ");
    if (roundsLabel && cadence) return `${roundsLabel} · ${cadence}`;
    return roundsLabel ?? cadence ?? null;
  }
  if (part.workoutType === "amrap" && part.amrapDurationSeconds) {
    return `${formatTime(part.amrapDurationSeconds)} AMRAP`;
  }
  if (part.repScheme) return part.repScheme;
  if (part.rounds) {
    const roundWord = part.workoutType === "for_load" ? "sets" : "rounds";
    return `${part.rounds} ${roundWord}`;
  }
  return null;
}
