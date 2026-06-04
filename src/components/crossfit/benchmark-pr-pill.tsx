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
import type {
  BenchmarkPartAttempt,
  BenchmarkPartInfo,
  BenchmarkSession,
} from "@/types/crossfit";

/**
 * Compact "your PR" pill that lives next to the Log Score CTA on a
 * programmed benchmark section. Click → opens a history dialog with every
 * prior session. Renders nothing when the athlete has no logged sessions
 * yet (first-timer experience stays clean) or when the workout is a
 * weightlifting rep-max benchmark — those have a per-rep-target history
 * the small pill can't cleanly express, and they have their own surface
 * on the benchmarks page.
 *
 * For multi-part benchmarks (Part A + Part B etc.) the pill shows the
 * PR for the first part — every part has its own scoring rule so one
 * pill can't show all of them — and the dialog renders one row per
 * session with every part's score stacked inside.
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

  const flat = data && "sessions" in data ? data : null;
  const sessions = flat?.sessions ?? [];
  const parts = flat?.parts ?? [];
  const benchmarkName = flat?.benchmarkName ?? fallbackName ?? "Workout";

  // The pill shows the first part's PR. For single-part benchmarks
  // that's just "the PR". For multi-part the first part is the
  // convention — the dialog reveals the rest.
  const firstPart = parts[0] ?? null;
  const prPartAttempt = useMemo<BenchmarkPartAttempt | null>(() => {
    if (!firstPart) return null;
    for (const s of sessions) {
      for (const pa of s.partAttempts) {
        if (pa.partId === firstPart.id && pa.isPR) return pa;
      }
    }
    return null;
  }, [sessions, firstPart]);

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

  if (!prPartAttempt || !firstPart) return null;

  const isMultiPart = parts.length > 1;
  const prText = formatBenchmarkAttempt(firstPart.workoutType, prPartAttempt);
  const prLabel = isMultiPart
    ? `PR (${firstPart.label ?? "Part A"})`
    : "PR";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300 transition-colors hover:bg-amber-500/15"
        aria-label={`Your ${prLabel} for ${benchmarkName} is ${prText}. View history.`}
      >
        <Star className="size-3" />
        {prLabel}: <span className="font-mono">{prText}</span>
        <span className="text-amber-300/60">
          · {formatShortDate(prPartAttempt.workoutDate)}
        </span>
      </button>
      <BenchmarkHistoryDialog
        open={open}
        onOpenChange={setOpen}
        benchmarkName={benchmarkName}
        parts={parts}
        sessions={sessions}
      />
    </>
  );
}

function BenchmarkHistoryDialog({
  open,
  onOpenChange,
  benchmarkName,
  parts,
  sessions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  benchmarkName: string;
  parts: BenchmarkPartInfo[];
  sessions: BenchmarkSession[];
}) {
  const isMultiPart = parts.length > 1;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{benchmarkName}</DialogTitle>
          <p className="text-xs text-muted-foreground">
            {sessions.length} session{sessions.length === 1 ? "" : "s"} — all
            time
          </p>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          {sessions.map((s) => (
            <SessionRow
              key={s.sessionId}
              session={s}
              isMultiPart={isMultiPart}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SessionRow({
  session,
  isMultiPart,
}: {
  session: BenchmarkSession;
  isMultiPart: boolean;
}) {
  const firstNotes = session.partAttempts.find((pa) => pa.notes)?.notes ?? null;
  return (
    <div className="flex items-start justify-between gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-col gap-0.5">
          {session.partAttempts.map((pa) => (
            <PartScoreLine
              key={pa.scoreId}
              partAttempt={pa}
              showPartLabel={isMultiPart}
            />
          ))}
        </div>
        {firstNotes && (
          <span className="line-clamp-1 text-[11px] text-muted-foreground">
            {firstNotes}
          </span>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="text-xs text-muted-foreground">
          {formatShortDate(session.workoutDate)}
        </span>
        <Badge
          variant="outline"
          className="text-[10px] uppercase text-muted-foreground"
        >
          {session.division.replace("_", " ")}
        </Badge>
      </div>
    </div>
  );
}

function PartScoreLine({
  partAttempt,
  showPartLabel,
}: {
  partAttempt: BenchmarkPartAttempt;
  showPartLabel: boolean;
}) {
  const display = formatBenchmarkAttempt(
    partAttempt.partWorkoutType,
    partAttempt
  );
  return (
    <div className="flex items-center gap-2">
      {showPartLabel && (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {partAttempt.partLabel ?? `Part ${partAttempt.partOrderIndex + 1}`}
        </span>
      )}
      <span className="text-sm font-semibold">{display}</span>
      {partAttempt.isPR && (
        <Badge className="gap-1 border border-amber-500/30 bg-amber-500/15 text-amber-300 hover:bg-amber-500/15">
          <Star className="size-3" />
          PR
        </Badge>
      )}
      {partAttempt.hitTimeCap && (
        <Badge
          variant="outline"
          className="text-[10px] text-muted-foreground"
        >
          capped
        </Badge>
      )}
    </div>
  );
}
