"use client";

// Per-day numeric input for non-WOD track days (spec §3.5). Renders
// either a "Mark done" toggle (when `allowJustDone`) or a numeric input
// with a unit suffix.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  useTrackDayRollup,
  useTrackDayScore,
  useUpsertTrackDayScore,
} from "@/hooks/useTracks";
import {
  trackScoringUnitLabel,
  type TrackScoringConfig,
} from "@/types/programming-tracks";

interface Props {
  trackDayId: string;
  scoringConfig: TrackScoringConfig | null;
  /** Prescribed value for this day (e.g. 40 from "40 sit-ups"). When
   *  `allowJustDone` is on and the athlete taps "Mark done", we auto-fill
   *  this so the day's reps still count toward the monthly rollup. */
  prescribedValue?: number | null;
}

export function TrackDayScoreInput({
  trackDayId,
  scoringConfig,
  prescribedValue = null,
}: Props) {
  const { data: scoreData } = useTrackDayScore(trackDayId);
  const { data: rollup } = useTrackDayRollup(trackDayId);
  const upsert = useUpsertTrackDayScore(trackDayId);
  const existing = scoreData?.score ?? null;

  const [numeric, setNumeric] = useState(
    existing?.numericValue != null ? String(existing.numericValue) : ""
  );
  const [notes, setNotes] = useState(existing?.notes ?? "");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNumeric(
      existing?.numericValue != null ? String(existing.numericValue) : ""
    );
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNotes(existing?.notes ?? "");
  }, [existing?.numericValue, existing?.notes]);

  const allowJustDone = scoringConfig?.allowJustDone === true;
  const unit = scoringConfig
    ? trackScoringUnitLabel(scoringConfig)
    : "";

  async function markDone() {
    try {
      // When the day has a prescribed amount (set by the progression
      // generator), tapping "Mark done" implies the athlete did the
      // prescription — auto-fill it so the value rolls up into monthly
      // totals. Falls back to null when no prescription is configured.
      await upsert.mutateAsync({
        isComplete: true,
        numericValue: prescribedValue,
      });
      toast.success("Marked done");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  async function undo() {
    try {
      await upsert.mutateAsync({ isComplete: false, numericValue: null });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  async function save() {
    const n = numeric.trim() ? Number(numeric) : null;
    if (!allowJustDone && (n == null || !Number.isFinite(n))) {
      toast.error("Enter a number");
      return;
    }
    try {
      await upsert.mutateAsync({
        numericValue: n,
        notes: notes.trim() || null,
        isComplete: true,
      });
      toast.success("Saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  // Daily target progress line.
  const dailyTarget = scoringConfig?.dailyTarget ?? null;
  const todayValue = rollup?.today.numericValue ?? null;
  const aggregation = scoringConfig?.aggregation ?? "per_day_independent";
  const sum = rollup?.sum ?? 0;

  if (allowJustDone) {
    return (
      <div className="space-y-2 rounded-md border border-white/10 bg-white/[0.02] p-3">
        {existing?.isComplete ? (
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-emerald-400" />
            <span className="text-sm">
              Marked done
              {existing.numericValue != null
                ? ` (${existing.numericValue}${unit ? ` ${unit}` : ""})`
                : ""}
              .
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={undo}
              disabled={upsert.isPending}
              className="ml-auto"
            >
              Undo
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            onClick={markDone}
            disabled={upsert.isPending}
          >
            {upsert.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : prescribedValue != null ? (
              `Mark done (${prescribedValue}${unit ? ` ${unit}` : ""})`
            ) : (
              "Mark done"
            )}
          </Button>
        )}
        {aggregation === "sum" && rollup && (
          <p className="text-[11px] text-muted-foreground">
            {rollup.daysLogged} of {rollup.daysAvailable} days logged
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-white/10 bg-white/[0.02] p-3">
      {scoringConfig?.description && (
        <p className="text-[11px] text-muted-foreground">
          {scoringConfig.description}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="numeric"
          value={numeric}
          onChange={(e) => setNumeric(e.target.value)}
          placeholder="0"
          className="max-w-[120px]"
        />
        {unit && (
          <span className="text-xs text-muted-foreground">{unit}</span>
        )}
        <Button
          size="sm"
          onClick={save}
          disabled={upsert.isPending}
          className="ml-auto"
        >
          {upsert.isPending ? "Saving…" : existing ? "Update" : "Save"}
        </Button>
      </div>
      <Textarea
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        className="text-xs"
      />
      {existing && (
        <p className="text-[11px] text-emerald-300/90">
          <CheckCircle2 className="mr-1 inline size-3" />
          Logged
          {todayValue != null ? `: ${todayValue} ${unit}` : null}
          {dailyTarget != null
            ? ` · Day target ${dailyTarget} ${unit}`
            : null}
        </p>
      )}
      {aggregation === "sum" && rollup && rollup.sum > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Total: {sum} {unit} across {rollup.daysLogged} day(s)
        </p>
      )}
    </div>
  );
}
