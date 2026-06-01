"use client";

import { useMemo, useState } from "react";
import { Star, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useBenchmarkHistory } from "@/hooks/useBenchmarks";
import { formatShortDate } from "@/lib/format-date";
import { formatBenchmarkAttempt } from "@/lib/crossfit/format-attempt";
import type { BenchmarkAttempt, WorkoutType } from "@/types/crossfit";

/**
 * Compact "your PR" pill that lives next to the Log Score CTA on a
 * programmed benchmark section. Click → opens a history dialog with every
 * prior attempt. Renders nothing when the athlete has no logged attempts
 * yet (first-timer experience stays clean) or when the workout is a
 * weightlifting rep-max benchmark — those have a per-rep-target history
 * the small pill can't cleanly express, and they have their own surface
 * on the benchmarks page.
 */
export function BenchmarkPrPill({
  benchmarkWorkoutId,
  fallbackName,
}: {
  benchmarkWorkoutId: string;
  fallbackName?: string;
}) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useBenchmarkHistory(benchmarkWorkoutId);

  const flat = data && "attempts" in data ? data : null;
  const attempts = flat?.attempts ?? [];
  const workoutType = flat?.workoutType ?? null;
  const benchmarkName = flat?.benchmarkName ?? fallbackName ?? "Workout";

  const prAttempt = useMemo(
    () => attempts.find((a) => a.isPR) ?? null,
    [attempts]
  );

  // Weightlifting branch: skip. The rep-max-tabs view on the benchmarks
  // page is the right surface for that history.
  if (data && "repMaxHistory" in data) return null;

  if (isLoading) {
    return (
      <div
        className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/30 px-2.5 py-1 text-[11px] text-muted-foreground"
        aria-label="Loading PR"
      >
        <Loader2 className="size-3 animate-spin" />
        PR
      </div>
    );
  }

  if (!prAttempt || !workoutType) return null;

  const prText = formatBenchmarkAttempt(workoutType, prAttempt);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300 transition-colors hover:bg-amber-500/15"
        aria-label={`Your PR for ${benchmarkName} is ${prText}. View history.`}
      >
        <Star className="size-3" />
        PR: <span className="font-mono">{prText}</span>
        <span className="text-amber-300/60">
          · {formatShortDate(prAttempt.workoutDate)}
        </span>
      </button>
      <BenchmarkHistoryDialog
        open={open}
        onOpenChange={setOpen}
        benchmarkName={benchmarkName}
        workoutType={workoutType}
        attempts={attempts}
      />
    </>
  );
}

function BenchmarkHistoryDialog({
  open,
  onOpenChange,
  benchmarkName,
  workoutType,
  attempts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  benchmarkName: string;
  workoutType: WorkoutType;
  attempts: BenchmarkAttempt[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{benchmarkName}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            {attempts.length} attempt{attempts.length === 1 ? "" : "s"} — all
            time
          </p>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          {attempts.map((a) => (
            <HistoryRow key={a.scoreId} attempt={a} workoutType={workoutType} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HistoryRow({
  attempt,
  workoutType,
}: {
  attempt: BenchmarkAttempt;
  workoutType: WorkoutType;
}) {
  const display = formatBenchmarkAttempt(workoutType, attempt);
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2">
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{display}</span>
          {attempt.isPR && (
            <Badge className="gap-1 border border-amber-500/30 bg-amber-500/15 text-amber-300 hover:bg-amber-500/15">
              <Star className="size-3" />
              PR
            </Badge>
          )}
          {attempt.hitTimeCap && (
            <Badge
              variant="outline"
              className="text-[10px] text-muted-foreground"
            >
              capped
            </Badge>
          )}
        </div>
        {attempt.notes && (
          <span className="line-clamp-1 text-[11px] text-muted-foreground">
            {attempt.notes}
          </span>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="text-xs text-muted-foreground">
          {formatShortDate(attempt.workoutDate)}
        </span>
        <Badge
          variant="outline"
          className="text-[10px] uppercase text-muted-foreground"
        >
          {attempt.division.replace("_", " ")}
        </Badge>
      </div>
    </div>
  );
}
