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
  Save,
  Sparkles,
  Loader2,
} from "lucide-react";
import {
  MultiPartConfig,
  emptyPart,
} from "@/components/crossfit/multi-part-config";
import { VestRequirements } from "@/components/crossfit/vest-requirements";
import { PartnerWorkoutToggle } from "@/components/crossfit/partner-workout-toggle";
import { parseDurationToSeconds } from "@/lib/crossfit/duration-parser";
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
import type { WorkoutSectionKind } from "@/db/schema";
import type { TrackKind } from "@/types/programming-tracks";

/**
 * Authoring context for the title suggestion. Tells the LLM whether this
 * prescription is a WOD, pre-skill build-up, post-skill finisher, monthly
 * challenge day, etc. — and gates benchmark matching server-side so
 * pre-skill ramps don't get tagged "Grace (modified)".
 */
export interface SmartBuilderContext {
  sectionKind?: WorkoutSectionKind | null;
  trackKind?: TrackKind | null;
}

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
  // Hide the date input — used when the parent fixes the date (e.g.
  // programming a section for a specific day).
  hideDateInput?: boolean;
  // Hide the partner toggle — used when partner/solo is decided by the
  // athlete at scoring time, not when programming.
  hidePartner?: boolean;
  // Hide the vest requirements block — same rationale as hidePartner for
  // gym programming.
  hideVest?: boolean;
  // Authoring context. Forwarded to /api/workouts/suggest-title so the
  // LLM knows whether it's naming a WOD, pre-/post-skill section,
  // monthly challenge day, etc. Also gates server-side benchmark
  // matching (no "Grace (modified)" for a pre-skill build-up).
  context?: SmartBuilderContext;
}

type Step = "build" | "review";

function createEmptyForm(workoutDate?: string): WorkoutBuilderForm {
  return {
    title: "",
    description: "",
    workoutDate: workoutDate || localTodayString(),
    parts: [emptyPart()],
    vestRequirement: "none",
    vestWeightMaleLb: "",
    vestWeightFemaleLb: "",
  };
}

// When the M and F values both contain dashes (rep schemes like 75-50-25 vs.
// 60-40-20), the bare "X/Y" format is ambiguous — readers can't tell if
// "75-50-25/60-40-20" means alternating rounds or a gendered split. Add an
// explicit "(M)" / "(F)" annotation in that case.
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
  // Both populated and divergent. If either side carries a dash-separated
  // scheme, label the M/F to disambiguate.
  if (m.includes("-") || f.includes("-")) {
    return `${m} ${unit} (M) / ${f} ${unit} (F)`;
  }
  return `${m}/${f} ${unit}`;
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

// Newly-added blocks reference by `blockTempRef`; round-tripped blocks
// (when editing) reference by `blockId`.
function smartBuilderMovementBlockKey(
  m: WorkoutBuilderMovement
): string | null {
  return m.blockTempRef ?? m.blockId ?? null;
}

// A for_load complex renders as one unbroken line — "5 Shoulder Press +
// 5 Push Press + 5 Push Jerk" — so the "+" makes the no-rest sequence clear.
function SmartBuilderComplexLine({
  movements,
}: {
  movements: WorkoutBuilderMovement[];
}) {
  if (movements.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
        {movements.map((m, i) => (
          <span key={m.tempId} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-muted-foreground">+</span>}
            {m.prescribedReps && (
              <span className="text-muted-foreground">{m.prescribedReps}</span>
            )}
            <span className="font-medium">{m.movementName}</span>
          </span>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Unbroken — no rest between movements.
      </p>
    </div>
  );
}

function SmartBuilderMovementBlocks({ part }: { part: WorkoutBuilderPart }) {
  // A complex is one unbroken set — render it joined, ignoring block grouping.
  if (part.structure === "complex") {
    return <SmartBuilderComplexLine movements={part.movements} />;
  }
  const blocks = part.blocks ?? [];
  const orderedBlocks = [...blocks].sort(
    (a, b) => a.orderIndex - b.orderIndex
  );

  const movementsByBlockTempId = new Map<string, WorkoutBuilderMovement[]>();
  const ungrouped: WorkoutBuilderMovement[] = [];
  for (const m of part.movements) {
    const key = smartBuilderMovementBlockKey(m);
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
        <SmartBuilderMovementList movements={ungrouped} />
      )}
      {orderedBlocks.map((b) => {
        const blockMovements = movementsByBlockTempId.get(b.tempId) ?? [];
        if (blockMovements.length === 0) return null;
        return (
          <div key={b.tempId} className="space-y-1">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {b.title}
            </h4>
            <SmartBuilderMovementList movements={blockMovements} />
          </div>
        );
      })}
    </div>
  );
}

function SmartBuilderMovementList({
  movements,
}: {
  movements: WorkoutBuilderMovement[];
}) {
  return (
    <div className="space-y-1">
      {movements.map((m, i) => {
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
              <span className="text-xs text-muted-foreground">({metric})</span>
            )}
          </div>
        );
      })}
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
  hideDateInput,
  hidePartner,
  hideVest,
  context,
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

  const handlePartsChange = useCallback(
    (parts: WorkoutBuilderPart[]) => {
      setForm((prev) => ({ ...prev, parts }));
    },
    []
  );

  // Deterministic local fallback — keeps existing behavior when the
  // suggestion endpoint returns nothing or hasn't fired yet.
  const localFallbackTitle = useMemo(() => {
    const firstPart = form.parts[0];
    if (!firstPart) return "";
    // Timed Rounds gets its own template — "Every 5:00 × 5 — Slowest Round"
    // (with window) or "5 Timed Rounds — Slowest Round" (without). Same
    // contract as the spec acceptance criteria.
    if (firstPart.workoutType === "timed_rounds") {
      const aggregation = firstPart.roundScoreAggregation ?? "slowest";
      const aggregationLabel =
        aggregation === "fastest"
          ? "Fastest Round"
          : aggregation === "sum"
            ? "Sum"
            : aggregation === "average"
              ? "Avg Round"
              : "Slowest Round";
      const rounds = firstPart.rounds || "5";
      const window = firstPart.roundWindowInput?.trim();
      const headline = window
        ? `Every ${window} × ${rounds}`
        : `${rounds} Timed Rounds`;
      return `${headline} — ${aggregationLabel}`;
    }
    const typeLabel = WORKOUT_TYPE_LABELS[firstPart.workoutType];
    // For Quality blocks often have no movements — fall back to the first
    // line of the prescription so the title isn't a bare "For Quality".
    if (firstPart.workoutType === "for_quality") {
      const firstLine = firstPart.partDescription
        ?.split("\n")
        .map((l) => l.trim())
        .find(Boolean);
      if (firstLine) {
        return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine;
      }
    }
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
      vest: form.vestRequirement ?? "none",
      vm: form.vestWeightMaleLb || null,
      vf: form.vestWeightFemaleLb || null,
      ctxS: context?.sectionKind ?? null,
      ctxT: context?.trackKind ?? null,
    };
    return JSON.stringify(payload);
  }, [
    form.parts,
    form.vestRequirement,
    form.vestWeightMaleLb,
    form.vestWeightFemaleLb,
    context?.sectionKind,
    context?.trackKind,
  ]);

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
          timeCapSeconds: parseDurationToSeconds(p.timeCapInput),
          amrapDurationSeconds: parseDurationToSeconds(p.amrapDurationInput),
          movementIds: p.movements
            .map((m) => m.movementId)
            .filter((id): id is string => !!id),
          extraMovementNames: p.movements
            .filter((m) => !m.movementId && m.movementName)
            .map((m) => m.movementName),
        })),
        vestRequirement: form.vestRequirement ?? "none",
        vestWeightMaleLb: form.vestWeightMaleLb
          ? Number(form.vestWeightMaleLb)
          : null,
        vestWeightFemaleLb: form.vestWeightFemaleLb
          ? Number(form.vestWeightFemaleLb)
          : null,
        context: context
          ? {
              sectionKind: context.sectionKind ?? null,
              trackKind: context.trackKind ?? null,
            }
          : undefined,
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
  }, [
    form.parts,
    form.vestRequirement,
    form.vestWeightMaleLb,
    form.vestWeightFemaleLb,
    context,
  ]);

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
    form.parts.every(
      (p) =>
        p.movements.length > 0 ||
        // For Quality is a free-text practice block — movements are optional,
        // so it's reviewable once it has a prescription or a duration.
        (p.workoutType === "for_quality" &&
          (!!p.partDescription?.trim() || !!p.timeCapInput.trim()))
    );

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

          <MultiPartConfig
            parts={form.parts}
            onPartsChange={handlePartsChange}
            isPartnerWorkout={!!form.isPartner}
            enableWeightPct
          />

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
                    {part.workoutType === "for_load" &&
                    part.structure === "complex"
                      ? " · Complex"
                      : ""}
                    {part.workoutType === "for_load" && part.rounds
                      ? ` · ${part.rounds} sets`
                      : ""}
                    {part.repScheme ? ` · ${part.repScheme}` : ""}
                    {part.workoutType === "amrap" && part.amrapDurationInput
                      ? ` · ${part.amrapDurationInput}`
                      : ""}
                    {part.workoutType === "timed_rounds" && part.rounds
                      ? part.roundWindowInput?.trim()
                        ? ` · Every ${part.roundWindowInput} × ${part.rounds}`
                        : ` · ${part.rounds} timed rounds`
                      : ""}
                    {(part.workoutType === "for_time" ||
                      part.workoutType === "emom" ||
                      part.workoutType === "for_reps") &&
                    part.timeCapInput
                      ? ` · ${part.timeCapInput} cap`
                      : ""}
                    {part.workoutType === "for_quality" && part.timeCapInput
                      ? ` · ${part.timeCapInput} clock`
                      : ""}
                  </span>
                </div>
                {part.workoutType === "for_quality" &&
                  part.partDescription?.trim() && (
                    <p className="whitespace-pre-wrap text-sm text-foreground/85">
                      {part.partDescription.trim()}
                    </p>
                  )}
                <Separator />
                <SmartBuilderMovementBlocks part={part} />
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
          {!hideDateInput && (
            <WorkoutDateInput
              id="sb-date"
              label="Date"
              value={form.workoutDate}
              onChange={(value) =>
                setForm((prev) => ({ ...prev, workoutDate: value }))
              }
            />
          )}

          {/* Workout requirements (vest) */}
          {!hideVest && (
            <VestRequirements
              vestRequirement={form.vestRequirement ?? "none"}
              vestWeightMaleLb={form.vestWeightMaleLb ?? ""}
              vestWeightFemaleLb={form.vestWeightFemaleLb ?? ""}
              onChange={(updates) =>
                setForm((prev) => ({ ...prev, ...updates }))
              }
            />
          )}

          {/* Partner / team workout. Description carries the split
              strategy — we don't try to model "tag your partner" yet. */}
          {!hidePartner && (
            <PartnerWorkoutToggle
              isPartner={!!form.isPartner}
              partnerCount={form.partnerCount ?? ""}
              onChange={(updates) =>
                setForm((prev) => ({ ...prev, ...updates }))
              }
            />
          )}

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
