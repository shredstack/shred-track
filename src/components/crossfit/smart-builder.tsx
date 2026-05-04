"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Save,
  Sparkles,
  Trash2,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { WorkoutPartConfig } from "@/components/crossfit/workout-part-config";
import { VestRequirements } from "@/components/crossfit/vest-requirements";
import {
  WorkoutDateInput,
  localTodayString,
} from "@/components/crossfit/workout-date-input";
import type {
  WorkoutBuilderForm,
  WorkoutBuilderPart,
  WorkoutBuilderMovement,
} from "@/types/crossfit";
import { WORKOUT_TYPE_LABELS, WORKOUT_TYPE_COLORS } from "@/types/crossfit";

interface SmartBuilderProps {
  onSave: (form: WorkoutBuilderForm) => void;
  onCancel?: () => void;
  // When provided, pre-populates the form for editing an existing workout.
  // The save handler is responsible for routing to the update endpoint.
  initialForm?: WorkoutBuilderForm;
  // Label for the primary save action (e.g. "Save Changes" in edit mode).
  saveLabel?: string;
  // YYYY-MM-DD (caller-local). Used as the default workout date for new
  // workouts so "Add Workout" while viewing a non-today date saves to the
  // date the user is looking at, not today.
  defaultWorkoutDate?: string;
}

type Step = "build" | "review";

const MAX_PARTS = 6;

function generatePartId() {
  return `part-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function emptyPart(): WorkoutBuilderPart {
  return {
    tempId: generatePartId(),
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

function createEmptyForm(workoutDate?: string): WorkoutBuilderForm {
  return {
    title: "",
    description: "",
    workoutDate: workoutDate || localTodayString(),
    parts: [emptyPart()],
    requiresVest: false,
    vestWeightMaleLb: "",
    vestWeightFemaleLb: "",
  };
}

// Single-line metric summary for the review screen. Returns the gendered
// pair for whichever metric type the movement uses, or null when the
// builder hasn't filled in any metric yet.
function formatBuilderMovementMetric(
  m: WorkoutBuilderMovement
): string | null {
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

function partSummary(part: WorkoutBuilderPart, idx: number): string {
  const parts: string[] = [];
  parts.push(part.label || `Part ${String.fromCharCode(65 + idx)}`);
  parts.push(WORKOUT_TYPE_LABELS[part.workoutType]);
  if (part.workoutType === "for_time" && part.rounds)
    parts.push(`${part.rounds} rds`);
  if (part.workoutType === "for_reps" && part.structure === "tabata")
    parts.push("Tabata");
  if (part.workoutType === "intervals") {
    if (part.rounds) parts.push(`${part.rounds} rds`);
    if (part.intervalWorkSeconds && part.intervalRestSeconds) {
      parts.push(
        `${part.intervalWorkSeconds} work / ${part.intervalRestSeconds} rest`
      );
    }
  }
  if (part.repScheme) parts.push(part.repScheme);
  if (part.workoutType === "amrap" && part.amrapDurationMinutes)
    parts.push(`${part.amrapDurationMinutes} min`);
  if (
    (part.workoutType === "for_time" ||
      part.workoutType === "emom" ||
      part.workoutType === "for_reps") &&
    part.timeCapMinutes
  )
    parts.push(`${part.timeCapMinutes} min`);
  const movs = part.movements
    .slice(0, 2)
    .map((m) => m.movementName)
    .filter(Boolean)
    .join(", ");
  if (movs) parts.push(movs);
  return parts.join(" · ");
}

// ============================================
// PartCard
// ============================================

interface PartCardProps {
  part: WorkoutBuilderPart;
  index: number;
  totalParts: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onChange: (updates: Partial<WorkoutBuilderPart>) => void;
  onMovementsChange: (movements: WorkoutBuilderMovement[]) => void;
  onMove: (direction: "up" | "down") => void;
  onDelete: () => void;
}

function PartCard({
  part,
  index,
  totalParts,
  isCollapsed,
  onToggleCollapse,
  onChange,
  onMovementsChange,
  onMove,
  onDelete,
}: PartCardProps) {
  const defaultLabel = `Part ${String.fromCharCode(65 + index)}`;

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
            <span className="truncate text-xs text-muted-foreground">
              {partSummary(part, index)}
            </span>
          )}
        </button>
        {totalParts > 1 && (
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
        )}
      </div>

      {!isCollapsed && (
        <div className="space-y-3 pt-1">
          {totalParts > 1 && (
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
          )}

          <WorkoutPartConfig
            part={part}
            onChange={onChange}
            onMovementsChange={onMovementsChange}
            compact
          />
        </div>
      )}
    </div>
  );
}

// ============================================
// Smart Builder
// ============================================

export function SmartBuilder({
  onSave,
  onCancel,
  initialForm,
  saveLabel,
  defaultWorkoutDate,
}: SmartBuilderProps) {
  const [step, setStep] = useState<Step>("build");
  const [form, setForm] = useState<WorkoutBuilderForm>(
    () => initialForm ?? createEmptyForm(defaultWorkoutDate)
  );

  // Resync the form when the parent recomputes `initialForm` (e.g. the
  // editing target changed). Without this, the form's useState initializer
  // only fires on first mount, so editing workout A → workout B kept the
  // first form's state. Guarded by `step !== "review"` so we don't blow
  // away in-flight review edits when a parent prop changes mid-session.
  useEffect(() => {
    if (!initialForm) return;
    if (step === "review") return;
    setForm(initialForm);
  }, [initialForm, step]);
  // Always start with every part expanded — collapsed parts hide the edit
  // surface and confuse users into thinking parts can only be reordered or
  // deleted. The user can collapse manually via the chevron.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [suggestion, setSuggestion] = useState<{
    title: string;
    source: string;
    benchmarkWorkoutId?: string;
  } | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);

  const goBack = useCallback(() => {
    setStep((s) => (s === "review" ? "build" : s));
  }, []);

  const goNext = useCallback(() => {
    setStep((s) => (s === "build" ? "review" : s));
  }, []);

  const updatePart = useCallback(
    (tempId: string, updates: Partial<WorkoutBuilderPart>) => {
      setForm((prev) => ({
        ...prev,
        parts: prev.parts.map((p) =>
          p.tempId === tempId ? { ...p, ...updates } : p
        ),
      }));
    },
    []
  );

  const updatePartMovements = useCallback(
    (tempId: string, movements: WorkoutBuilderMovement[]) => {
      setForm((prev) => ({
        ...prev,
        parts: prev.parts.map((p) =>
          p.tempId === tempId ? { ...p, movements } : p
        ),
      }));
    },
    []
  );

  const addPart = useCallback(() => {
    setForm((prev) => {
      if (prev.parts.length >= MAX_PARTS) return prev;
      const newPart = emptyPart();
      // Collapse all existing parts, expand the new one.
      setCollapsed(new Set(prev.parts.map((p) => p.tempId)));
      return { ...prev, parts: [...prev.parts, newPart] };
    });
  }, []);

  const deletePart = useCallback((tempId: string) => {
    setForm((prev) => {
      if (prev.parts.length <= 1) return prev;
      return { ...prev, parts: prev.parts.filter((p) => p.tempId !== tempId) };
    });
  }, []);

  const movePart = useCallback((tempId: string, direction: "up" | "down") => {
    setForm((prev) => {
      const idx = prev.parts.findIndex((p) => p.tempId === tempId);
      if (idx === -1) return prev;
      const swap = direction === "up" ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= prev.parts.length) return prev;
      const next = [...prev.parts];
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return { ...prev, parts: next };
    });
  }, []);

  const toggleCollapse = useCallback((tempId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(tempId)) next.delete(tempId);
      else next.add(tempId);
      return next;
    });
  }, []);

  // Deterministic local fallback — keeps existing behavior when the
  // suggestion endpoint returns nothing or hasn't fired yet.
  const localFallbackTitle = useMemo(() => {
    const firstPart = form.parts[0];
    if (!firstPart) return "";
    const typeLabel = WORKOUT_TYPE_LABELS[firstPart.workoutType];
    const names = firstPart.movements
      .slice(0, 2)
      .map((m) => m.movementName)
      .filter(Boolean)
      .join(", ");
    return names ? `${typeLabel} — ${names}` : typeLabel;
  }, [form.parts]);

  // ============================================
  // Title suggestion — fires once we reach review
  // ============================================

  const specHash = useMemo(() => {
    const payload = {
      parts: form.parts.map((p) => ({
        type: p.workoutType,
        rep: p.repScheme || null,
        ms: p.movements.map((m) => m.movementId || m.movementName).sort(),
      })),
      vest: !!form.requiresVest,
      vm: form.vestWeightMaleLb || null,
      vf: form.vestWeightFemaleLb || null,
    };
    return JSON.stringify(payload);
  }, [form.parts, form.requiresVest, form.vestWeightMaleLb, form.vestWeightFemaleLb]);

  const requestSuggestion = useCallback(async () => {
    // Bail if there's nothing to suggest for.
    const hasAnyMovement = form.parts.some((p) => p.movements.length > 0);
    if (!hasAnyMovement) return;

    setSuggestLoading(true);
    try {
      const body = {
        parts: form.parts.map((p) => ({
          workoutType: p.workoutType,
          repScheme: p.repScheme || null,
          timeCapSeconds: p.timeCapMinutes
            ? parseInt(p.timeCapMinutes) * 60
            : null,
          amrapDurationSeconds: p.amrapDurationMinutes
            ? parseInt(p.amrapDurationMinutes) * 60
            : null,
          movementIds: p.movements
            .map((m) => m.movementId)
            .filter((id): id is string => !!id),
          extraMovementNames: p.movements
            .filter((m) => !m.movementId && m.movementName)
            .map((m) => m.movementName),
        })),
        requiresVest: !!form.requiresVest,
        vestWeightMaleLb: form.vestWeightMaleLb
          ? Number(form.vestWeightMaleLb)
          : null,
        vestWeightFemaleLb: form.vestWeightFemaleLb
          ? Number(form.vestWeightFemaleLb)
          : null,
      };
      const res = await fetch("/api/workouts/suggest-title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        title: string;
        source: string;
        benchmarkWorkoutId?: string;
      };
      setSuggestion(data);
      // Only auto-set benchmarkWorkoutId on exact benchmark match.
      if (data.source === "benchmark" && data.benchmarkWorkoutId) {
        setForm((prev) => ({
          ...prev,
          benchmarkWorkoutId: data.benchmarkWorkoutId,
        }));
      } else {
        setForm((prev) =>
          prev.benchmarkWorkoutId ? { ...prev, benchmarkWorkoutId: null } : prev
        );
      }
    } catch (err) {
      console.warn("[smart-builder] title suggestion failed", err);
    } finally {
      setSuggestLoading(false);
    }
  }, [form.parts]);

  // Fetch suggestion once we enter review, debounced per-spec-hash.
  useEffect(() => {
    if (step !== "review") return;
    const t = setTimeout(() => {
      requestSuggestion();
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, specHash]);

  const suggestedTitle = suggestion?.title || localFallbackTitle;

  const handleSubmit = useCallback(() => {
    onSave({
      ...form,
      title: form.title || suggestedTitle,
    });
  }, [form, suggestedTitle, onSave]);

  const canReview =
    form.parts.length > 0 &&
    form.parts.every((p) => p.movements.length > 0);

  // ============================================
  // Render
  // ============================================

  return (
    <div className="space-y-4">
      {/* Progress indicator */}
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
        <div className="space-y-3">
          <h3 className="font-semibold">Build your workout</h3>

          {form.parts.map((part, idx) => (
            <PartCard
              key={part.tempId}
              part={part}
              index={idx}
              totalParts={form.parts.length}
              isCollapsed={collapsed.has(part.tempId)}
              onToggleCollapse={() => toggleCollapse(part.tempId)}
              onChange={(updates) => updatePart(part.tempId, updates)}
              onMovementsChange={(movements) =>
                updatePartMovements(part.tempId, movements)
              }
              onMove={(direction) => movePart(part.tempId, direction)}
              onDelete={() => deletePart(part.tempId)}
            />
          ))}

          {form.parts.length < MAX_PARTS && (
            <Button
              type="button"
              variant="outline"
              className="w-full border-dashed"
              onClick={addPart}
            >
              <Plus className="size-4" />
              Add another part
            </Button>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              onClick={goNext}
              className="flex-1"
              disabled={!canReview}
            >
              Review
              <ArrowRight className="size-4" />
            </Button>
            {onCancel && (
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
            )}
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
              onClick={goBack}
            >
              <ArrowLeft className="size-4" />
            </Button>
            <h3 className="font-semibold">Review & Save</h3>
          </div>

          {/* Parts summary */}
          <div className="space-y-2">
            {form.parts.map((part, idx) => (
              <div
                key={part.tempId}
                className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={WORKOUT_TYPE_COLORS[part.workoutType]}
                  >
                    {part.label || `Part ${String.fromCharCode(65 + idx)}`}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {WORKOUT_TYPE_LABELS[part.workoutType]}
                    {part.workoutType === "for_time" && part.rounds
                      ? ` · ${part.rounds} rds`
                      : ""}
                    {part.workoutType === "for_reps" &&
                    part.structure === "tabata"
                      ? " · Tabata"
                      : ""}
                    {part.repScheme ? ` · ${part.repScheme}` : ""}
                    {part.workoutType === "amrap" && part.amrapDurationMinutes
                      ? ` · ${part.amrapDurationMinutes} min`
                      : ""}
                    {(part.workoutType === "for_time" ||
                      part.workoutType === "emom" ||
                      part.workoutType === "for_reps") &&
                    part.timeCapMinutes
                      ? ` · ${part.timeCapMinutes} min`
                      : ""}
                  </span>
                </div>
                <Separator />
                <div className="space-y-1">
                  {part.movements.map((m, i) => {
                    const metric = formatBuilderMovementMetric(m);
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
              </div>
            ))}
          </div>

          {/* Title */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="sb-title">Title</Label>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {suggestLoading && (
                  <Loader2 className="size-3 animate-spin" />
                )}
                {suggestion?.source === "benchmark" && (
                  <span className="flex items-center gap-1 text-emerald-400">
                    <Sparkles className="size-3" />
                    Benchmark match
                  </span>
                )}
                {suggestion?.source === "benchmark_modified" && (
                  <span className="flex items-center gap-1 text-amber-400">
                    <Sparkles className="size-3" />
                    Close to benchmark
                  </span>
                )}
                {suggestion?.source === "ai" && (
                  <span className="flex items-center gap-1 text-primary">
                    <Sparkles className="size-3" />
                    AI-suggested
                  </span>
                )}
              </div>
            </div>
            <Input
              id="sb-title"
              value={form.title}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, title: e.target.value }))
              }
              placeholder={suggestedTitle}
            />
            {suggestion?.source !== "benchmark" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={requestSuggestion}
                disabled={suggestLoading}
                className="text-xs text-muted-foreground"
              >
                <Sparkles className="size-3" />
                Suggest another
              </Button>
            )}
          </div>

          {/* Date */}
          <WorkoutDateInput
            id="sb-date"
            label="Date"
            value={form.workoutDate}
            onChange={(value) =>
              setForm((prev) => ({ ...prev, workoutDate: value }))
            }
          />

          {/* Workout requirements (vest) */}
          <VestRequirements
            requiresVest={!!form.requiresVest}
            vestWeightMaleLb={form.vestWeightMaleLb ?? ""}
            vestWeightFemaleLb={form.vestWeightFemaleLb ?? ""}
            onChange={(updates) =>
              setForm((prev) => ({ ...prev, ...updates }))
            }
          />

          {/* Partner / team workout. Description carries the split
              strategy — we don't try to model "tag your partner" yet. */}
          <div className="space-y-2 rounded-lg border border-border/50 bg-muted/20 p-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!!form.isPartner}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    isPartner: e.target.checked,
                    // Default to 2 (partner) when toggling on; clear count
                    // when toggling off so we don't carry stale state.
                    partnerCount: e.target.checked
                      ? prev.partnerCount || "2"
                      : "",
                  }))
                }
                className="size-4 cursor-pointer"
              />
              <span className="text-sm font-medium">
                Partner / team workout
              </span>
            </label>
            {form.isPartner && (
              <div className="space-y-1.5 pl-6">
                <Label className="text-xs text-muted-foreground">
                  Team size
                </Label>
                <Input
                  type="number"
                  min={2}
                  max={20}
                  value={form.partnerCount ?? ""}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      partnerCount: e.target.value,
                    }))
                  }
                  placeholder="e.g. 2"
                  className="h-8 max-w-[120px] text-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                  Use the notes below to explain how partners split the
                  work (e.g. &quot;one works while the other rests&quot;).
                </p>
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="sb-notes">Notes (optional)</Label>
            <Textarea
              id="sb-notes"
              value={form.description}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, description: e.target.value }))
              }
              placeholder="e.g. Each Tabata is 8 rounds of :20 work / :10 rest. No breaks between Tabatas."
              rows={3}
              className="resize-y text-sm"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Button type="button" onClick={handleSubmit} className="flex-1">
              <Save className="size-4" />
              {saveLabel ?? "Save Workout"}
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
