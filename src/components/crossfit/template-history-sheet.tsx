"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  History as HistoryIcon,
  Loader2,
  Star,
  ChevronDown,
  ChevronRight,
  Shield,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FullScreenSheet } from "@/components/ui/full-screen-sheet";
import {
  MovementScalingRow,
  type MovementScalingDetail,
} from "@/components/crossfit/movement-scaling-row";
import { formatTime } from "@/lib/workout-parser";
import { formatShortDate } from "@/lib/format-date";
import type { SetEntry, WorkoutType } from "@/types/crossfit";

// Template-history sheet. Triggered from the History link in a workout
// card header. Shows every prior score this athlete has logged against the
// same template; per-row expansion reveals every dimension of scaling
// (modification text, substitution, weight, reps, duration, height,
// per-round arrays, per-set entries) via the shared MovementScalingRow.

interface TemplateHistoryMovementRow {
  crossfitWorkoutMovementId: string | null;
  movementName: string | null;
  wasRx: boolean;
  actualWeightLb: number | null;
  actualReps: string | null;
  modification: string | null;
  substitutionName: string | null;
  setEntries: SetEntry[] | null;
  actualDurationSeconds: number | null;
  actualHeightInches: number | null;
  actualRepsPerRound: number[] | null;
  actualDurationSecondsPerRound: number[] | null;
  actualWeightLbsPerRound: number[] | null;
}

interface TemplateHistoryScoreRow {
  scoreId: string;
  workoutSessionId: string;
  workoutDate: string;
  division: "rx" | "scaled" | "rx_plus";
  workoutType: WorkoutType;
  timeSeconds: number | null;
  rounds: number | null;
  remainderReps: number | null;
  weightLbs: number | null;
  totalReps: number | null;
  scoreText: string | null;
  hitTimeCap: boolean;
  notes: string | null;
  rpe: number | null;
  woreVest: boolean | null;
  vestWeightLb: number | null;
  isPr: boolean;
  createdAt: string;
  movements: TemplateHistoryMovementRow[];
}

interface TemplateHistoryResponse {
  templateId: string;
  templateTitle: string;
  workoutType: WorkoutType;
  isBenchmark: boolean;
  isSystem: boolean;
  scores: TemplateHistoryScoreRow[];
  count: number;
}

const DIVISION_LABEL: Record<TemplateHistoryScoreRow["division"], string> = {
  rx: "Rx",
  scaled: "Scaled",
  rx_plus: "Rx+",
};

function formatScore(row: TemplateHistoryScoreRow): string {
  if (row.timeSeconds) {
    let s = formatTime(row.timeSeconds);
    if (row.hitTimeCap) s += " (cap)";
    return s;
  }
  if (row.rounds != null) {
    let s = `${row.rounds} rds`;
    if (row.remainderReps) s += ` + ${row.remainderReps} reps`;
    return s;
  }
  if (row.weightLbs != null) return `${row.weightLbs} lb`;
  if (row.totalReps != null) return `${row.totalReps} reps`;
  if (row.scoreText) return row.scoreText;
  return "—";
}

function useTemplateHistory(
  crossfitWorkoutId: string | null,
  enabled: boolean
) {
  return useQuery<TemplateHistoryResponse>({
    queryKey: ["template-history", crossfitWorkoutId],
    enabled: enabled && !!crossfitWorkoutId,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch(
        `/api/crossfit/templates/${crossfitWorkoutId}/history`
      );
      if (!res.ok) throw new Error("Failed to load history");
      return res.json();
    },
  });
}

export function TemplateHistoryLink({
  crossfitWorkoutId,
  isSystemTemplate,
  count,
}: {
  crossfitWorkoutId: string | null;
  /** Hide the link entirely on system benchmarks when the athlete has zero
   *  prior scores (per spec §"History affordance"). */
  isSystemTemplate?: boolean;
  /** Server-supplied count when available — avoids the round-trip just to
   *  render "History (3)". */
  count?: number | null;
}) {
  const [open, setOpen] = useState(false);

  if (!crossfitWorkoutId) return null;
  if (isSystemTemplate && count === 0) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
        aria-label="View history for this template"
      >
        <HistoryIcon className="size-3.5" />
        History{count != null && count > 0 ? ` (${count})` : ""}
      </Button>
      {open && (
        <TemplateHistorySheet
          crossfitWorkoutId={crossfitWorkoutId}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}

export function TemplateHistorySheet({
  crossfitWorkoutId,
  open,
  onOpenChange,
}: {
  crossfitWorkoutId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading } = useTemplateHistory(crossfitWorkoutId, open);

  return (
    <FullScreenSheet
      open={open}
      onOpenChange={onOpenChange}
      title={data?.templateTitle ?? "History"}
      icon={HistoryIcon}
      subtitle={
        data
          ? `${data.count} attempt${data.count === 1 ? "" : "s"} — all time`
          : undefined
      }
    >
      <div className="space-y-2 p-4">
        {isLoading && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        )}
        {!isLoading && data && data.count === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            First time logging this one — your history starts here.
          </p>
        )}
        {!isLoading && data && data.count > 0 && (
          <div className="space-y-2">
            {data.scores.map((row) => (
              <HistoryRow key={row.scoreId} row={row} />
            ))}
          </div>
        )}
      </div>
    </FullScreenSheet>
  );
}

function HistoryRow({ row }: { row: TemplateHistoryScoreRow }) {
  const [expanded, setExpanded] = useState(false);
  const display = formatScore(row);
  // Every score with logged movement details is expandable — Rx-Rx-Rx rows
  // still tell the athlete what they used, especially weight on
  // athlete-picked-weight movements.
  const hasMovementDetails = row.movements.length > 0;
  const hasScaledMovements = row.movements.some((m) => !m.wasRx);

  return (
    <div className="rounded-lg border border-border/40 bg-muted/20">
      <button
        type="button"
        onClick={() => hasMovementDetails && setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left disabled:cursor-default"
        disabled={!hasMovementDetails}
      >
        <div className="flex flex-1 flex-col gap-0.5 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold">{display}</span>
            {row.isPr && (
              <Badge className="gap-1 border border-amber-500/30 bg-amber-500/15 text-amber-300 hover:bg-amber-500/15">
                <Star className="size-3" />
                PR
              </Badge>
            )}
            <Badge
              variant="outline"
              className={`text-[10px] uppercase ${
                row.division === "scaled"
                  ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
                  : row.division === "rx_plus"
                    ? "border-violet-500/30 bg-violet-500/10 text-violet-400"
                    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              }`}
            >
              {DIVISION_LABEL[row.division]}
            </Badge>
            {hasScaledMovements && row.division !== "scaled" && (
              <Badge
                variant="outline"
                className="text-[9px] uppercase border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
              >
                Per-movement scaling
              </Badge>
            )}
            {row.woreVest === true && (
              <Badge
                variant="outline"
                className="bg-amber-500/15 text-[10px] text-amber-300 border-amber-500/30"
              >
                <Shield className="mr-0.5 size-2.5" />
                Vest
                {row.vestWeightLb != null ? ` ${row.vestWeightLb}` : ""}
              </Badge>
            )}
            {row.rpe != null && (
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                RPE {row.rpe}
              </span>
            )}
          </div>
          {row.notes && (
            <span className="line-clamp-1 text-[11px] text-muted-foreground">
              {row.notes}
            </span>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="text-xs text-muted-foreground">
            {formatShortDate(row.workoutDate)}
          </span>
          {hasMovementDetails && (
            <span className="text-muted-foreground">
              {expanded ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
            </span>
          )}
        </div>
      </button>

      {expanded && hasMovementDetails && (
        <div className="space-y-2 border-t border-border/30 px-3 py-2">
          {row.notes && (
            <div className="space-y-0.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Notes
              </span>
              <p className="whitespace-pre-wrap text-xs text-foreground/90">
                {row.notes}
              </p>
            </div>
          )}
          <div className="space-y-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Per-movement
            </span>
            {row.movements.map((m, idx) => (
              <MovementScalingRow
                key={m.crossfitWorkoutMovementId ?? idx}
                detail={toScalingDetail(m)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function toScalingDetail(
  m: TemplateHistoryMovementRow
): MovementScalingDetail {
  return {
    movementName: m.movementName,
    wasRx: m.wasRx,
    actualWeightLb: m.actualWeightLb,
    actualReps: m.actualReps,
    modification: m.modification,
    substitutionName: m.substitutionName,
    setEntries: m.setEntries,
    actualDurationSeconds: m.actualDurationSeconds,
    actualHeightInches: m.actualHeightInches,
    actualRepsPerRound: m.actualRepsPerRound,
    actualDurationSecondsPerRound: m.actualDurationSecondsPerRound,
    actualWeightLbsPerRound: m.actualWeightLbsPerRound,
  };
}
