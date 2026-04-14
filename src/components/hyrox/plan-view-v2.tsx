"use client";

import { memo, useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Activity,
  Dumbbell,
  Trophy,
  Coffee,
  Pencil,
  ArrowLeft,
  Clock,
  Wrench,
  GripVertical,
  ArrowUpDown,
  CheckCircle2,
  Clipboard,
  RefreshCw,
  Archive,
} from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { PaceInput } from "@/components/shared/pace-input";
import { DistanceInput } from "@/components/shared/distance-input";
import { WeightInput } from "@/components/shared/weight-input";
import { TimeInput } from "@/components/shared/time-input";
import { usePlanWeeks, useReorderSessions, useLogSession, type MovementResult } from "@/hooks/useHyroxPlan";
import type { SessionDetail, SessionBlock, SessionMovement } from "@/types/hyrox-plan";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

type SessionTypeKey = "run" | "station_skills" | "hyrox_day" | "rest";

const TYPE_CONFIG: Record<
  SessionTypeKey,
  { icon: typeof Activity; color: string; bg: string; label: string }
> = {
  run: { icon: Activity, color: "text-blue-400", bg: "bg-blue-500/10", label: "Run" },
  station_skills: { icon: Dumbbell, color: "text-orange-400", bg: "bg-orange-500/10", label: "Station Skills" },
  hyrox_day: { icon: Trophy, color: "text-violet-400", bg: "bg-violet-500/10", label: "HYROX Day" },
  rest: { icon: Coffee, color: "text-muted-foreground", bg: "bg-white/[0.04]", label: "Rest" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLogSummary(log: SessionLog, sessionType: string): string {
  const parts: string[] = [];

  if (log.actualPace) {
    const unit = log.actualPaceUnit ? ` /${log.actualPaceUnit}` : "";
    parts.push(`${log.actualPace}${unit}`);
  }
  if (log.actualDistanceValue && log.actualDistanceUnit) {
    parts.push(`${log.actualDistanceValue} ${log.actualDistanceUnit}`);
  }

  // Per-movement results summary
  const movResults = (log.movementResults ?? []) as MovementResult[];
  if (movResults.length > 0) {
    const movSummary = movResults
      .map((mr) => {
        const timeParts: string[] = [];
        if (mr.setTimesSeconds && mr.setTimesSeconds.length > 0) {
          timeParts.push(
            mr.setTimesSeconds
              .map((s) => {
                const m = Math.floor(s / 60);
                const sec = s % 60;
                return `${m}:${String(sec).padStart(2, "0")}`;
              })
              .join("/")
          );
        }
        if (mr.weightValue != null) {
          timeParts.push(`${mr.weightValue}${mr.weightUnit ?? "kg"}`);
        }
        return timeParts.length > 0
          ? `${mr.movementName}: ${timeParts.join(", ")}`
          : null;
      })
      .filter(Boolean);
    if (movSummary.length > 0) {
      // Keep it short for the card — show first movement, abbreviate rest
      parts.push(movSummary[0]!);
      if (movSummary.length > 1) {
        parts.push(`+${movSummary.length - 1} more`);
      }
    }
  } else {
    // Legacy single-value fields
    if (log.actualTimeSeconds != null && (sessionType === "station_skills" || sessionType === "hyrox_day")) {
      const m = Math.floor(log.actualTimeSeconds / 60);
      const s = log.actualTimeSeconds % 60;
      parts.push(`${m}:${String(s).padStart(2, "0")}`);
    }
    if (log.actualReps != null) {
      parts.push(`${log.actualReps} reps`);
    }
    if (log.actualWeightValue && log.actualWeightUnit) {
      parts.push(`${log.actualWeightValue} ${log.actualWeightUnit}`);
    }
  }

  if (log.rpe != null) {
    parts.push(`RPE ${log.rpe}`);
  }

  return parts.join(" \u00b7 ");
}

function formatTimeShort(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Types for API response
// ---------------------------------------------------------------------------

interface SessionLog {
  id: string;
  planSessionId: string;
  userId: string;
  status: string;
  actualPace: string | null;
  actualPaceUnit: string | null;
  actualTimeSeconds: number | null;
  actualReps: number | null;
  actualDistance: string | null;
  actualDistanceValue: string | null;
  actualDistanceUnit: string | null;
  actualWeight: string | null;
  actualWeightValue: string | null;
  actualWeightUnit: string | null;
  movementResults: MovementResult[] | null;
  rpe: number | null;
  notes: string | null;
  loggedAt: string;
}

interface PlanSession {
  id: string;
  planId: string;
  week: number;
  dayOfWeek: number;
  sessionType: string;
  title: string;
  description: string;
  targetPace: string | null;
  durationMinutes: number | null;
  phase: string;
  orderInDay: number;
  phaseId: string | null;
  aiGenerated: boolean | null;
  athleteModified: boolean | null;
  originalSessionData: unknown;
  sessionDetail: SessionDetail | null;
  equipmentRequired: string[] | null;
  createdAt: string;
  log: SessionLog | null;
}

interface CompletionStatus {
  logged: number;
  total: number;
  complete: boolean;
}

interface PlanWeeksResponse {
  plan: {
    id: string;
    title: string;
    totalWeeks: number;
    startDate: string | null;
    endDate: string | null;
    generationStatus: string;
    trainingPhilosophy: string | null;
  };
  phases: {
    id: string;
    phaseNumber: number;
    name: string;
    description: string;
    startWeek: number;
    endWeek: number;
    focusAreas: string[] | null;
  }[];
  weeks: {
    weekNumber: number;
    phase: {
      id: string;
      phaseNumber: number;
      name: string;
      description: string;
      startWeek: number;
      endWeek: number;
      focusAreas: string[] | null;
    } | null;
    sessions: PlanSession[];
    completionStatus: CompletionStatus;
  }[];
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PlanViewV2Props {
  planId: string;
  isReadOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4 animate-pulse">
      {/* Phase bar placeholder */}
      <div className="flex gap-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-2 flex-1 rounded-full bg-muted/50" />
        ))}
      </div>
      {/* Week selector placeholder */}
      <div className="flex items-center justify-between">
        <div className="h-8 w-8 rounded bg-muted/50" />
        <div className="flex flex-col items-center gap-1">
          <div className="h-5 w-24 rounded bg-muted/50" />
          <div className="h-3 w-32 rounded bg-muted/50" />
        </div>
        <div className="h-8 w-8 rounded bg-muted/50" />
      </div>
      {/* Session cards placeholder */}
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-20 rounded-lg bg-muted/50" />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase progress bar
// ---------------------------------------------------------------------------

function PhaseProgressBar({
  phases,
  currentWeek,
}: {
  phases: PlanWeeksResponse["phases"];
  currentWeek: number;
}) {
  if (phases.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1">
        {phases.map((phase) => {
          const isActive = currentWeek >= phase.startWeek && currentWeek <= phase.endWeek;
          const isPast = currentWeek > phase.endWeek;

          return (
            <div
              key={phase.id}
              className="flex flex-col items-center gap-1 flex-1"
            >
              <div
                className={`h-2 w-full rounded-full transition-colors ${
                  isActive
                    ? "bg-primary drop-shadow-[0_0_6px_oklch(0.85_0.20_130_/_30%)]"
                    : isPast
                      ? "bg-primary/40"
                      : "bg-muted/50"
                }`}
              />
              <span
                className={`text-[10px] leading-tight text-center ${
                  isActive ? "text-primary font-medium" : "text-muted-foreground"
                }`}
              >
                {phase.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session card
// ---------------------------------------------------------------------------

function SortableSessionCard({
  session,
  onSelect,
  isReordering,
}: {
  session: PlanSession;
  onSelect: (id: string) => void;
  isReordering?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: session.id, disabled: !isReordering });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.8 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <SessionCard
        session={session}
        onSelect={onSelect}
        isReordering={isReordering}
        dragListeners={listeners}
      />
    </div>
  );
}

const SessionCard = memo(function SessionCard({
  session,
  onSelect,
  isReordering,
  dragListeners,
}: {
  session: PlanSession;
  onSelect: (id: string) => void;
  isReordering?: boolean;
  dragListeners?: Record<string, unknown>;
}) {
  const config = TYPE_CONFIG[session.sessionType as SessionTypeKey] ?? TYPE_CONFIG.rest;
  const Icon = config.icon;
  const isLogged = session.log?.status === "completed";
  const isSkipped = session.log?.status === "skipped";

  return (
    <Card
      className={`transition-all duration-200 ${isReordering ? "" : "cursor-pointer hover:ring-1 hover:ring-primary/20"}`}
      size="sm"
      onClick={isReordering ? undefined : () => onSelect(session.id)}
    >
      <CardContent className="flex items-center gap-3 py-0">
        {isReordering && (
          <button
            className="shrink-0 touch-none cursor-grab active:cursor-grabbing p-1 -ml-1 rounded hover:bg-white/[0.08]"
            {...dragListeners}
          >
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${config.bg}`}
        >
          {isLogged ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          ) : (
            <Icon className={`h-4 w-4 ${config.color}`} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {DAY_LABELS[session.dayOfWeek] ?? `Day ${session.dayOfWeek}`}
            </span>
            <span className={`truncate text-sm font-semibold ${isSkipped ? "line-through text-muted-foreground" : ""}`}>
              {session.title}
            </span>
            {session.athleteModified && (
              <Badge variant="outline" className="shrink-0 text-[9px] px-1.5 py-0 gap-0.5">
                <Pencil className="h-2.5 w-2.5" />
                edited
              </Badge>
            )}
          </div>
          {isLogged && session.log ? (
            <p className="text-xs text-emerald-400/80 truncate">
              {formatLogSummary(session.log, session.sessionType)}
            </p>
          ) : isSkipped ? (
            <p className="text-xs text-muted-foreground">Skipped</p>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {session.durationMinutes && (
                <span className="flex items-center gap-0.5">
                  <Clock className="h-3 w-3" />
                  {session.durationMinutes}m
                </span>
              )}
              {session.description && (
                <span className="truncate">{session.description}</span>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
});

// ---------------------------------------------------------------------------
// Session log form
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers for parsing prescription into set count
// ---------------------------------------------------------------------------

/** Try to extract a set count from a prescription string like "2 × 250m" or "3 x 25m" */
function parseSetCount(prescription: string): number {
  const match = prescription.match(/^(\d+)\s*[×x]/i);
  return match ? parseInt(match[1], 10) : 1;
}

/** Detect if a movement likely uses weight (sled, carry, sandbag, etc.) */
function movementUsesWeight(name: string): boolean {
  const lower = name.toLowerCase();
  return /sled|carry|farmer|sandbag|lunge|wall ball|kettlebell|dumbbell|barbell|weight/i.test(lower);
}

function secsToTimeStr(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function parseTimeStr(time: string): number | undefined {
  if (!time) return undefined;
  const parts = time.split(":").map(Number);
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1]) && (parts[0] > 0 || parts[1] > 0)) {
    return parts[0] * 60 + parts[1];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Per-movement state type used in the form
// ---------------------------------------------------------------------------

interface MovementFormState {
  blockIndex: number;
  movementIndex: number;
  movementName: string;
  setCount: number;
  /** One TimeInput value per set, e.g. ["1:32", "1:28"] */
  setTimes: string[];
  weightValue: string;
  weightUnit: "kg" | "lb";
  showWeight: boolean;
}

function SessionLogForm({
  session,
  onClose,
}: {
  session: PlanSession;
  onClose: () => void;
}) {
  const logMutation = useLogSession();
  const existingLog = session.log;
  const detail = session.sessionDetail as SessionDetail | null;

  const isRun = session.sessionType === "run";
  const isStation = session.sessionType === "station_skills";
  const isHyroxDay = session.sessionType === "hyrox_day";
  const hasStationBlocks = (isStation || isHyroxDay) && detail && detail.blocks.length > 0;

  // --- Run-level fields (for run and hyrox_day run portion) ---
  const [actualPace, setActualPace] = useState(existingLog?.actualPace ?? ":");
  const [paceUnit, setPaceUnit] = useState<"mi" | "km">(
    (existingLog?.actualPaceUnit as "mi" | "km") ?? "mi"
  );
  const [distanceValue, setDistanceValue] = useState(
    existingLog?.actualDistanceValue ?? ""
  );
  const [distanceUnit, setDistanceUnit] = useState<"mi" | "km">(
    (existingLog?.actualDistanceUnit as "mi" | "km") ?? "mi"
  );

  // --- Per-movement state (for station_skills and hyrox_day station blocks) ---
  const [movements, setMovements] = useState<MovementFormState[]>(() => {
    if (!hasStationBlocks || !detail) return [];

    // Hydrate from existing log if available
    const existing = (existingLog?.movementResults ?? []) as MovementResult[];
    const existingMap = new Map(
      existing.map((r) => [`${r.blockIndex}-${r.movementIndex}`, r])
    );

    const result: MovementFormState[] = [];
    detail.blocks.forEach((block, bIdx) => {
      block.movements.forEach((mov, mIdx) => {
        const key = `${bIdx}-${mIdx}`;
        const prev = existingMap.get(key);
        const setCount = parseSetCount(mov.prescription);

        const setTimes: string[] = prev?.setTimesSeconds
          ? prev.setTimesSeconds.map(secsToTimeStr)
          : prev?.timeSeconds
            ? [secsToTimeStr(prev.timeSeconds)]
            : Array.from({ length: setCount }, () => ":");

        result.push({
          blockIndex: bIdx,
          movementIndex: mIdx,
          movementName: mov.name,
          setCount,
          setTimes,
          weightValue: prev?.weightValue != null ? String(prev.weightValue) : "",
          weightUnit: (prev?.weightUnit as "kg" | "lb") ?? "kg",
          showWeight: movementUsesWeight(mov.name),
        });
      });
    });
    return result;
  });

  const [rpe, setRpe] = useState(existingLog?.rpe ?? 7);
  const [notes, setNotes] = useState(existingLog?.notes ?? "");

  // --- Mutation helpers ---
  const updateMovement = useCallback(
    (bIdx: number, mIdx: number, update: Partial<MovementFormState>) => {
      setMovements((prev) =>
        prev.map((m) =>
          m.blockIndex === bIdx && m.movementIndex === mIdx
            ? { ...m, ...update }
            : m
        )
      );
    },
    []
  );

  const updateSetTime = useCallback(
    (bIdx: number, mIdx: number, setIdx: number, value: string) => {
      setMovements((prev) =>
        prev.map((m) => {
          if (m.blockIndex !== bIdx || m.movementIndex !== mIdx) return m;
          const next = [...m.setTimes];
          next[setIdx] = value;
          return { ...m, setTimes: next };
        })
      );
    },
    []
  );

  const parsePace = (pace: string): string | undefined => {
    const secs = parseTimeStr(pace);
    if (secs == null) return undefined;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const handleSubmit = (status: "completed" | "skipped") => {
    // Build run-level data
    const parsedPace = parsePace(actualPace);
    const parsedDist = distanceValue ? parseFloat(distanceValue) : undefined;

    // Build per-movement results
    const movementResults: MovementResult[] = movements
      .map((m) => {
        const setTimesSeconds = m.setTimes
          .map(parseTimeStr)
          .filter((v): v is number => v != null);
        const wv = m.weightValue ? parseFloat(m.weightValue) : undefined;

        // Skip movements with no data entered
        if (setTimesSeconds.length === 0 && !wv) return null;

        return {
          blockIndex: m.blockIndex,
          movementIndex: m.movementIndex,
          movementName: m.movementName,
          setTimesSeconds: setTimesSeconds.length > 0 ? setTimesSeconds : undefined,
          weightValue: wv && !isNaN(wv) ? wv : undefined,
          weightUnit: wv && !isNaN(wv) ? m.weightUnit : undefined,
        } as MovementResult;
      })
      .filter((v): v is MovementResult => v != null);

    logMutation.mutate(
      {
        sessionId: session.id,
        data: {
          status,
          actualPace: parsedPace,
          actualPaceUnit: parsedPace ? paceUnit : undefined,
          actualDistanceValue: parsedDist && !isNaN(parsedDist) ? parsedDist : undefined,
          actualDistanceUnit: parsedDist && !isNaN(parsedDist) ? distanceUnit : undefined,
          movementResults: movementResults.length > 0 ? movementResults : undefined,
          rpe,
          notes: notes || undefined,
        },
      },
      { onSuccess: onClose }
    );
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          {existingLog ? "Update Log" : "Log Results"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Run fields */}
        {(isRun || isHyroxDay) && (
          <>
            <div className="space-y-1.5">
              <Label>Actual Pace</Label>
              <PaceInput
                value={actualPace}
                onChange={setActualPace}
                unit={paceUnit}
                onUnitChange={setPaceUnit}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Distance</Label>
              <DistanceInput
                value={distanceValue}
                onChange={setDistanceValue}
                unit={distanceUnit}
                onUnitChange={setDistanceUnit}
              />
            </div>
          </>
        )}

        {/* Per-movement station fields */}
        {hasStationBlocks && detail && movements.length > 0 && (
          <div className="space-y-4">
            {detail.blocks.map((block, bIdx) => {
              const blockMovements = movements.filter(
                (m) => m.blockIndex === bIdx
              );
              if (blockMovements.length === 0) return null;

              return (
                <div key={bIdx} className="space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {block.label}
                  </p>
                  {blockMovements.map((mov) => (
                    <div
                      key={`${mov.blockIndex}-${mov.movementIndex}`}
                      className="rounded-lg border border-white/[0.06] p-3 space-y-2.5"
                    >
                      <p className="text-sm font-medium">{mov.movementName}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {block.movements[mov.movementIndex]?.prescription}
                      </p>

                      {/* Per-set time inputs */}
                      <div className="space-y-1.5">
                        {mov.setTimes.map((time, setIdx) => (
                          <div
                            key={setIdx}
                            className="flex items-center gap-2"
                          >
                            <span className="text-[10px] text-muted-foreground w-10 shrink-0">
                              {mov.setCount > 1
                                ? `Set ${setIdx + 1}`
                                : "Time"}
                            </span>
                            <TimeInput
                              mode="ms"
                              value={time}
                              onChange={(v) =>
                                updateSetTime(
                                  mov.blockIndex,
                                  mov.movementIndex,
                                  setIdx,
                                  v
                                )
                              }
                            />
                          </div>
                        ))}
                      </div>

                      {/* Weight input (only for movements that use weight) */}
                      {mov.showWeight && (
                        <div className="space-y-1">
                          <span className="text-[10px] text-muted-foreground">
                            Weight
                          </span>
                          <WeightInput
                            value={mov.weightValue}
                            onChange={(v) =>
                              updateMovement(mov.blockIndex, mov.movementIndex, {
                                weightValue: v,
                              })
                            }
                            unit={mov.weightUnit}
                            onUnitChange={(u) =>
                              updateMovement(mov.blockIndex, mov.movementIndex, {
                                weightUnit: u,
                              })
                            }
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {/* Fallback: single station fields when there are no detail blocks */}
        {(isStation || isHyroxDay) && !hasStationBlocks && (
          <>
            <div className="space-y-1.5">
              <Label>Time (MM:SS)</Label>
              <TimeInput mode="ms" value=":" onChange={() => {}} />
            </div>
            <div className="space-y-1.5">
              <Label>Weight</Label>
              <WeightInput
                value=""
                onChange={() => {}}
                unit="kg"
                onUnitChange={() => {}}
              />
            </div>
          </>
        )}

        {/* RPE */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>RPE (Rate of Perceived Exertion)</Label>
            <span className="font-mono text-sm text-primary">{rpe}/10</span>
          </div>
          <Slider
            min={1}
            max={10}
            value={[rpe]}
            onValueChange={(val) => setRpe(Array.isArray(val) ? val[0] : val)}
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Easy</span>
            <span>Maximal</span>
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <Label>Notes</Label>
          <Textarea
            placeholder="How did it feel?"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={() => handleSubmit("skipped")}
            className="flex-1"
            disabled={logMutation.isPending}
          >
            Skip
          </Button>
          <Button
            onClick={() => handleSubmit("completed")}
            className="flex-1"
            disabled={logMutation.isPending}
          >
            <CheckCircle2 className="mr-1 h-4 w-4" />
            {logMutation.isPending ? "Saving..." : "Done"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Log results card (displayed in session detail panel)
// ---------------------------------------------------------------------------

function LogResultsCard({
  log,
  session,
}: {
  log: SessionLog;
  session: PlanSession;
}) {
  const movResults = (log.movementResults ?? []) as MovementResult[];
  const hasRunData = !!(log.actualPace || log.actualDistanceValue);
  const hasMovementData = movResults.length > 0;

  if (!hasRunData && !hasMovementData && log.rpe == null && !log.notes)
    return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            Your Results
          </CardTitle>
          <span className="text-[10px] text-muted-foreground">
            {new Date(log.loggedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {/* Run-level results */}
        {log.actualPace && (
          <LogResultRow
            label="Pace"
            value={`${log.actualPace}${log.actualPaceUnit ? ` /${log.actualPaceUnit}` : ""}`}
            comparison={session.targetPace ? `target: ${session.targetPace}` : undefined}
            comparisonColor={
              session.targetPace
                ? getPaceComparisonColor(log.actualPace, session.targetPace)
                : undefined
            }
          />
        )}
        {log.actualDistanceValue && log.actualDistanceUnit && (
          <LogResultRow
            label="Distance"
            value={`${log.actualDistanceValue} ${log.actualDistanceUnit}`}
          />
        )}

        {/* Per-movement results */}
        {hasMovementData && (
          <div className="space-y-2 pt-1">
            {movResults.map((mr, i) => (
              <div
                key={i}
                className="rounded-md border border-white/[0.06] p-2 space-y-1"
              >
                <p className="text-xs font-medium">{mr.movementName}</p>
                {mr.setTimesSeconds && mr.setTimesSeconds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {mr.setTimesSeconds.map((secs, sIdx) => (
                      <Badge
                        key={sIdx}
                        variant="secondary"
                        className="text-[10px] font-mono gap-0.5"
                      >
                        {mr.setTimesSeconds!.length > 1
                          ? `S${sIdx + 1}: `
                          : ""}
                        {formatTimeShort(secs)}
                      </Badge>
                    ))}
                  </div>
                )}
                {mr.timeSeconds != null && !mr.setTimesSeconds?.length && (
                  <span className="text-xs font-mono">
                    {formatTimeShort(mr.timeSeconds)}
                  </span>
                )}
                {mr.weightValue != null && (
                  <span className="text-xs font-mono text-muted-foreground ml-2">
                    {mr.weightValue} {mr.weightUnit ?? "kg"}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* RPE */}
        {log.rpe != null && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">RPE</span>
            <div className="flex items-center gap-2">
              <div className="flex gap-0.5">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 w-2 rounded-sm ${
                      i < log.rpe! ? "bg-primary" : "bg-muted/30"
                    }`}
                  />
                ))}
              </div>
              <span className="text-sm font-mono font-medium">
                {log.rpe}/10
              </span>
            </div>
          </div>
        )}

        {/* Notes */}
        {log.notes && (
          <div className="pt-1 border-t border-white/[0.06]">
            <p className="text-xs text-muted-foreground italic line-clamp-3">
              &ldquo;{log.notes}&rdquo;
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LogResultRow({
  label,
  value,
  comparison,
  comparisonColor,
}: {
  label: string;
  value: string;
  comparison?: string;
  comparisonColor?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-mono font-medium">{value}</span>
        {comparison && (
          <span
            className={`text-[10px] ${comparisonColor ?? "text-muted-foreground"}`}
          >
            ({comparison})
          </span>
        )}
      </div>
    </div>
  );
}

function getPaceComparisonColor(
  actualPace: string,
  targetPace: string
): string | undefined {
  const actualSecs = parsePaceToSeconds(actualPace);
  const targetSecs = parsePaceToSeconds(
    targetPace.replace(/\s*\/.*$/, "")
  );
  if (actualSecs == null || targetSecs == null) return undefined;
  const diff = (actualSecs - targetSecs) / targetSecs;
  if (diff <= 0) return "text-emerald-400";
  if (diff <= 0.1) return "text-amber-400";
  return "text-red-400";
}

// ---------------------------------------------------------------------------
// Week stats summary
// ---------------------------------------------------------------------------

function WeekStats({ sessions }: { sessions: PlanSession[] }) {
  const stats = useMemo(() => {
    const loggedSessions = sessions.filter(
      (s) => s.log?.status === "completed"
    );
    if (loggedSessions.length === 0) return null;

    // Average RPE
    const rpeLogs = loggedSessions.filter((s) => s.log?.rpe != null);
    const avgRpe =
      rpeLogs.length > 0
        ? rpeLogs.reduce((sum, s) => sum + (s.log?.rpe ?? 0), 0) / rpeLogs.length
        : null;

    // Total distance (normalize to a single display unit — prefer what most logs use)
    let totalMi = 0;
    let totalKm = 0;
    for (const s of loggedSessions) {
      const val = s.log?.actualDistanceValue ? parseFloat(s.log.actualDistanceValue) : 0;
      if (!val) continue;
      if (s.log?.actualDistanceUnit === "km") totalKm += val;
      else totalMi += val;
    }
    // Convert everything to the dominant unit
    const useMiles = totalMi >= totalKm * 0.621371;
    const totalDistance = useMiles
      ? totalMi + totalKm * 0.621371
      : totalKm + totalMi * 1.60934;
    const distUnit = useMiles ? "mi" : "km";

    return {
      avgRpe: avgRpe != null ? avgRpe.toFixed(1) : null,
      totalDistance: totalDistance > 0 ? totalDistance.toFixed(1) : null,
      distUnit,
      loggedCount: loggedSessions.length,
    };
  }, [sessions]);

  if (!stats) return null;

  return (
    <div className="flex gap-2 flex-wrap">
      {stats.avgRpe && (
        <Badge variant="outline" className="text-[10px] gap-1 font-normal">
          Avg RPE: {stats.avgRpe}
        </Badge>
      )}
      {stats.totalDistance && (
        <Badge variant="outline" className="text-[10px] gap-1 font-normal">
          {stats.totalDistance} {stats.distUnit} this week
        </Badge>
      )}
    </div>
  );
}

function parsePaceToSeconds(pace: string): number | null {
  const parts = pace.split(":").map(Number);
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return parts[0] * 60 + parts[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Session detail panel
// ---------------------------------------------------------------------------

function SessionDetailPanel({
  session,
  onBack,
  isReadOnly = false,
}: {
  session: PlanSession;
  onBack: () => void;
  isReadOnly?: boolean;
}) {
  const detail = session.sessionDetail as SessionDetail | null;
  const config = TYPE_CONFIG[session.sessionType as SessionTypeKey] ?? TYPE_CONFIG.rest;
  const [showLogForm, setShowLogForm] = useState(false);
  const isRest = session.sessionType === "rest";
  const hasLog = session.log !== null;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground">
            {DAY_LABELS[session.dayOfWeek] ?? `Day ${session.dayOfWeek}`} — Week{" "}
            {session.week}
          </p>
          <h2 className="text-lg font-semibold truncate">{session.title}</h2>
        </div>
        {session.log?.status === "completed" && (
          <Badge variant="default" className="shrink-0 bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 text-[10px] gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Logged
          </Badge>
        )}
        {session.log?.status === "skipped" && (
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            Skipped
          </Badge>
        )}
        {session.athleteModified && (
          <Badge variant="outline" className="shrink-0 text-[10px] gap-1">
            <Pencil className="h-3 w-3" />
            Edited
          </Badge>
        )}
      </div>

      {/* Description */}
      <Card>
        <CardContent>
          <p className="text-sm">{session.description}</p>
        </CardContent>
      </Card>

      {/* Duration + pace */}
      {(session.durationMinutes || session.targetPace) && (
        <div className="flex gap-3">
          {session.durationMinutes && (
            <Badge variant="secondary" className="gap-1">
              <Clock className="h-3 w-3" />
              {session.durationMinutes} min
            </Badge>
          )}
          {session.targetPace && (
            <Badge variant="secondary" className="gap-1">
              <Activity className="h-3 w-3" />
              {session.targetPace}
            </Badge>
          )}
        </div>
      )}

      {/* Equipment required */}
      {session.equipmentRequired && session.equipmentRequired.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Wrench className="h-4 w-4" />
              Equipment Required
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {session.equipmentRequired.map((eq) => (
                <Badge key={eq} variant="outline" className="text-xs">
                  {eq}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Session detail blocks */}
      {detail && (
        <>
          {/* Warmup */}
          {detail.warmup && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Warmup</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-line">
                  {detail.warmup}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Blocks */}
          {detail.blocks.map((block: SessionBlock, blockIdx: number) => (
            <Card key={blockIdx}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{block.label}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {block.movements.map(
                  (movement: SessionMovement, movIdx: number) => (
                    <div key={movIdx} className="space-y-1">
                      <p className="text-sm font-medium">
                        {movement.name}
                      </p>
                      <p className="text-xs font-mono text-muted-foreground whitespace-pre-line break-words">
                        {movement.prescription}
                      </p>
                      {movement.rest && (
                        <p className="text-[11px] text-muted-foreground">
                          Rest: {movement.rest}
                        </p>
                      )}
                      {movement.notes && (
                        <p className="text-[11px] text-muted-foreground italic whitespace-pre-line break-words">
                          {movement.notes}
                        </p>
                      )}
                    </div>
                  )
                )}
              </CardContent>
            </Card>
          ))}

          {/* Cooldown */}
          {detail.cooldown && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Cooldown</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-line">
                  {detail.cooldown}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Coach notes */}
          {detail.coachNotes && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Coach Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-line">
                  {detail.coachNotes}
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Logged results display */}
      {hasLog && session.log?.status === "completed" && (
        <LogResultsCard log={session.log} session={session} />
      )}

      {/* Log form or log button (hidden in read-only mode) */}
      {!isReadOnly && !isRest && (
        showLogForm ? (
          <SessionLogForm
            session={session}
            onClose={() => setShowLogForm(false)}
          />
        ) : (
          <Button
            onClick={() => setShowLogForm(true)}
            variant={hasLog ? "outline" : "default"}
            className="w-full"
          >
            <Clipboard className="mr-2 h-4 w-4" />
            {hasLog ? "Update Log" : "Log This Session"}
          </Button>
        )
      )}

      {/* Edit button (hidden in read-only mode) */}
      {!isReadOnly && (
        <Button variant="outline" className="w-full" disabled>
          <Pencil className="mr-2 h-4 w-4" />
          Edit Session
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PlanViewV2({ planId, isReadOnly = false }: PlanViewV2Props) {
  const { data, isLoading, error } = usePlanWeeks(planId) as {
    data: PlanWeeksResponse | undefined;
    isLoading: boolean;
    error: Error | null;
  };

  const [weekIndex, setWeekIndex] = useState(0);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [isReordering, setIsReordering] = useState(false);
  const reorderMutation = useReorderSessions();
  const logMutation = useLogSession();
  const initialWeekSet = useRef(false);

  // DnD sensors (pointer for desktop, touch for mobile)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  // Smart week navigation: set initial week based on date + completion
  useEffect(() => {
    if (!data || initialWeekSet.current) return;
    initialWeekSet.current = true;

    const startDate = data.plan.startDate;
    if (!startDate) return;

    const start = new Date(startDate);
    const today = new Date();
    const diffDays = Math.floor(
      (today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
    );
    let weekIdx = Math.max(
      0,
      Math.min(data.weeks.length - 1, Math.floor(diffDays / 7))
    );

    // If current date-based week is complete, advance to next incomplete
    while (
      weekIdx < data.weeks.length - 1 &&
      data.weeks[weekIdx]?.completionStatus?.complete
    ) {
      weekIdx++;
    }

    setWeekIndex(weekIdx);
  }, [data]);

  const prevWeek = useCallback(
    () => setWeekIndex((i) => Math.max(0, i - 1)),
    []
  );
  const nextWeek = useCallback(
    () =>
      setWeekIndex((i) =>
        data ? Math.min(data.weeks.length - 1, i + 1) : i
      ),
    [data]
  );

  const handleSelectSession = useCallback((id: string) => {
    setSelectedSessionId(id);
  }, []);

  const handleBackFromDetail = useCallback(() => {
    setSelectedSessionId(null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !data) return;

      const week = data.weeks[weekIndex];
      if (!week) return;

      const sessions = week.sessions;
      const oldIndex = sessions.findIndex((s) => s.id === active.id);
      const newIndex = sessions.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      // Build assignments: each session gets the dayOfWeek from the position it's moving to
      const reordered = arrayMove(sessions, oldIndex, newIndex);
      const originalDays = sessions.map((s) => s.dayOfWeek);
      const assignments = reordered.map((session, idx) => ({
        sessionId: session.id,
        dayOfWeek: originalDays[idx],
      }));

      reorderMutation.mutate({
        planId,
        week: week.weekNumber,
        assignments,
      });
    },
    [data, weekIndex, planId, reorderMutation]
  );

  const toggleReordering = useCallback(() => {
    setIsReordering((prev) => !prev);
  }, []);

  const handleMarkWeekComplete = useCallback(() => {
    if (!data) return;
    const week = data.weeks[weekIndex];
    if (!week) return;

    const unlogged = week.sessions.filter(
      (s) => s.sessionType !== "rest" && s.log === null
    );

    for (const session of unlogged) {
      logMutation.mutate({
        sessionId: session.id,
        data: { status: "skipped" },
      });
    }
  }, [data, weekIndex, logMutation]);

  // Find the selected session across all weeks
  const selectedSession = useMemo(() => {
    if (!selectedSessionId || !data) return null;
    for (const week of data.weeks) {
      const found = week.sessions.find((s) => s.id === selectedSessionId);
      if (found) return found;
    }
    return null;
  }, [selectedSessionId, data]);

  // Session IDs for DnD sortable context
  const currentWeek = data?.weeks[weekIndex];
  const sessionIds = useMemo(
    () => currentWeek?.sessions.map((s) => s.id) ?? [],
    [currentWeek?.sessions]
  );

  // Loading state
  if (isLoading) {
    return <LoadingSkeleton />;
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <p className="text-sm text-muted-foreground">
          Failed to load training plan.
        </p>
        <p className="text-xs text-muted-foreground">{error.message}</p>
      </div>
    );
  }

  if (!data) return null;

  // Plan still generating
  if (
    data.plan.generationStatus === "pending" ||
    data.plan.generationStatus === "generating"
  ) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm font-medium">Generating your training plan...</p>
        <p className="text-xs text-muted-foreground">
          This may take a minute. The page will update automatically.
        </p>
      </div>
    );
  }

  // Generation failed
  if (data.plan.generationStatus === "failed") {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <p className="text-sm text-muted-foreground">
          Plan generation failed. Please try again.
        </p>
      </div>
    );
  }

  // Session detail view
  if (selectedSession) {
    return (
      <SessionDetailPanel
        session={selectedSession}
        onBack={handleBackFromDetail}
        isReadOnly={isReadOnly}
      />
    );
  }

  // Plan view
  const week = data.weeks[weekIndex];
  if (!week) return null;

  const { completionStatus } = week;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        {isReadOnly && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px] gap-1">
              <Archive className="h-3 w-3" />
              Archived Plan
            </Badge>
          </div>
        )}
        <div className={isReadOnly ? "" : "ml-auto"}>
          {isReadOnly ? (
            <a
              href="/hyrox/plan"
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors"
            >
              Back to current plan
            </a>
          ) : (
            <a
              href="/hyrox/onboarding"
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors"
            >
              <RefreshCw className="h-3 w-3" />
              New Plan
            </a>
          )}
        </div>
      </div>

      {/* Phase progress bar */}
      <PhaseProgressBar phases={data.phases} currentWeek={week.weekNumber} />

      {/* Week selector */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={prevWeek}
          disabled={weekIndex === 0}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-center">
          <p className="font-bold">Week {week.weekNumber}</p>
          {week.phase && (
            <p className="text-xs text-muted-foreground">{week.phase.name}</p>
          )}
          {/* Completion progress */}
          {!isReadOnly && completionStatus.total > 0 && (
            completionStatus.complete ? (
              <Badge variant="default" className="mt-1 bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 text-[10px] gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Week Complete
              </Badge>
            ) : (
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {completionStatus.logged}/{completionStatus.total} sessions logged
              </p>
            )
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={nextWeek}
          disabled={weekIndex === data.weeks.length - 1}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Reorder toggle + Mark week complete (hidden in read-only mode) */}
      {!isReadOnly && (
        <div className="flex justify-between">
          <div>
            {!completionStatus.complete && completionStatus.logged > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleMarkWeekComplete}
                className="text-xs gap-1.5 h-8 text-muted-foreground"
                disabled={logMutation.isPending}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Mark Week Complete
              </Button>
            )}
          </div>
          <Button
            variant={isReordering ? "secondary" : "ghost"}
            size="sm"
            onClick={toggleReordering}
            className="text-xs gap-1.5 h-8"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            {isReordering ? "Done" : "Reorder Days"}
          </Button>
        </div>
      )}

      {/* Week stats */}
      <WeekStats sessions={week.sessions} />

      {/* Day grid */}
      <div className="space-y-2">
        {week.sessions.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-4">
            No sessions for this week yet.
          </p>
        ) : isReordering ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={sessionIds} strategy={verticalListSortingStrategy}>
              {week.sessions.map((session) => (
                <SortableSessionCard
                  key={session.id}
                  session={session}
                  onSelect={handleSelectSession}
                  isReordering
                />
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          week.sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              onSelect={handleSelectSession}
            />
          ))
        )}
      </div>
    </div>
  );
}
