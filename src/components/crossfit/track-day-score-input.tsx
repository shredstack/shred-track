"use client";

// Per-day numeric input for non-WOD track days (spec §3.5). Renders
// either a "Mark done" form (when `allowJustDone`) — input pre-filled
// with the day's prescribed value so the athlete can confirm or modify
// before saving — or a plain numeric input with a unit suffix.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
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
  /** Prescribed value for this day (e.g. 40 from "40 sit-ups"). The
   *  "Mark done" input is pre-filled with this so the day's reps count
   *  toward the monthly rollup unless the athlete edits it. */
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

  // For the allowJustDone form, the input defaults to the prescribed
  // value when there's nothing logged yet — so tapping "Mark done"
  // without editing records the prescription.
  const initialNumeric = (() => {
    if (existing?.numericValue != null) return String(existing.numericValue);
    if (prescribedValue != null) return String(prescribedValue);
    return "";
  })();
  const [numeric, setNumeric] = useState(initialNumeric);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  // After marking done, collapse back to the summary view. Reopens when
  // the athlete clicks "Edit".
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNumeric(
      existing?.numericValue != null
        ? String(existing.numericValue)
        : prescribedValue != null
          ? String(prescribedValue)
          : ""
    );
    setNotes(existing?.notes ?? "");
  }, [existing?.numericValue, existing?.notes, prescribedValue]);

  const allowJustDone = scoringConfig?.allowJustDone === true;
  const unit = scoringConfig
    ? trackScoringUnitLabel(scoringConfig)
    : "";

  async function undo() {
    try {
      await upsert.mutateAsync({ isComplete: false, numericValue: null });
      setEditing(false);
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
    if (n != null && !Number.isFinite(n)) {
      toast.error("Enter a valid number");
      return;
    }
    try {
      await upsert.mutateAsync({
        numericValue: n,
        notes: notes.trim() || null,
        isComplete: true,
      });
      setEditing(false);
      toast.success(allowJustDone ? "Marked done" : "Saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  // Daily target progress line.
  const dailyTarget = scoringConfig?.dailyTarget ?? null;
  const todayValue = rollup?.today.numericValue ?? null;
  const isCumulative = rollup?.isCumulative ?? false;
  const sum = rollup?.sum ?? 0;

  if (allowJustDone) {
    const showForm = !existing?.isComplete || editing;
    return (
      <div className="space-y-2 rounded-md border border-white/10 bg-white/[0.02] p-3">
        {showForm ? (
          <>
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
                {upsert.isPending
                  ? "Saving…"
                  : existing?.isComplete
                    ? "Update"
                    : "Mark done"}
              </Button>
            </div>
            {prescribedValue != null && !existing?.isComplete && (
              <p className="text-[11px] text-muted-foreground">
                Programmed: {prescribedValue}
                {unit ? ` ${unit}` : ""} · edit if you did more or fewer.
              </p>
            )}
          </>
        ) : (
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-emerald-400" />
            <span className="text-sm">
              Marked done
              {existing?.numericValue != null
                ? ` (${existing.numericValue}${unit ? ` ${unit}` : ""})`
                : ""}
              .
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(true)}
                disabled={upsert.isPending}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={undo}
                disabled={upsert.isPending}
              >
                Undo
              </Button>
            </div>
          </div>
        )}
        {isCumulative && rollup && (
          <p className="text-[11px] text-muted-foreground">
            {rollup.daysLogged} of {rollup.daysAvailable} days logged
            {rollup.sum > 0 ? ` · Total: ${sum}${unit ? ` ${unit}` : ""}` : ""}
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
      {isCumulative && rollup && rollup.sum > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Total: {sum} {unit} across {rollup.daysLogged} day(s)
        </p>
      )}
    </div>
  );
}
