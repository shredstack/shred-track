"use client";

// Per-day input for monthly_challenge / custom-track days (spec §3.3).
//
// Picks render mode from the shape of the day's prescription:
//
//   - Sets mode (tile UI): when the body parses cleanly as a sets list
//     ("6 / 4 / 3 / 3 Burpees, rest :20"). The athlete ticks each tile
//     to log a partial day; "Mark all done" sets the day's score to the
//     prescribed sum. Tile state lives in trackDayScores.textValue as
//     `{"sets":[6,4]}` so refreshing the page doesn't lose checks.
//
//   - Single-value mode: when the body is one number or unstructured
//     prose. Delegates to the existing TrackDayScoreInput component —
//     unchanged behavior.
//
// A persistent footer shows today / cumulative / day-N-of-M / streak.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TrackDayScoreInput } from "@/components/crossfit/track-day-score-input";
import {
  useTrackDayRollup,
  useTrackDayScore,
  useUpsertTrackDayScore,
} from "@/hooks/useTracks";
import { parseSetsFromBody } from "@/lib/programming/challenge-builder";
import {
  trackScoringUnitLabel,
  type TrackScoringConfig,
} from "@/types/programming-tracks";

interface Props {
  trackDayId: string;
  scoringConfig: TrackScoringConfig | null;
  prescribedValue?: number | null;
  /** Day body text — used to detect sets-mode. */
  body?: string | null;
  /** When present, the footer shows "Day N of M". */
  dayNumber?: number | null;
  totalDays?: number | null;
}

function parseSetsState(textValue: string | null | undefined): number[] {
  if (!textValue) return [];
  try {
    const parsed = JSON.parse(textValue);
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { sets?: unknown }).sets)
    ) {
      return (parsed as { sets: number[] }).sets.filter(
        (n) => typeof n === "number" && Number.isFinite(n) && n >= 0
      );
    }
  } catch {
    // not JSON
  }
  return [];
}

export function TrackDayChallengeInput({
  trackDayId,
  scoringConfig,
  prescribedValue,
  body,
  dayNumber,
  totalDays,
}: Props) {
  const parsed = useMemo(() => parseSetsFromBody(body ?? null), [body]);
  const isSetsMode = parsed != null && parsed.sets.length >= 2;

  if (!isSetsMode) {
    return (
      <div className="space-y-2">
        <TrackDayScoreInput
          trackDayId={trackDayId}
          scoringConfig={scoringConfig}
          prescribedValue={prescribedValue ?? null}
        />
        <ChallengeFooter
          trackDayId={trackDayId}
          scoringConfig={scoringConfig}
          dayNumber={dayNumber}
          totalDays={totalDays}
        />
      </div>
    );
  }

  return (
    <>
      <SetsTileInput
        trackDayId={trackDayId}
        scoringConfig={scoringConfig}
        sets={parsed!.sets}
        restHint={parsed!.restHint}
        label={parsed!.label}
      />
      <ChallengeFooter
        trackDayId={trackDayId}
        scoringConfig={scoringConfig}
        dayNumber={dayNumber}
        totalDays={totalDays}
      />
    </>
  );
}

function SetsTileInput({
  trackDayId,
  scoringConfig,
  sets,
  restHint,
  label,
}: {
  trackDayId: string;
  scoringConfig: TrackScoringConfig | null;
  sets: number[];
  restHint?: string;
  label: string;
}) {
  const { data: scoreData } = useTrackDayScore(trackDayId);
  const upsert = useUpsertTrackDayScore(trackDayId);
  const existing = scoreData?.score ?? null;

  // The tile state is the *completion* of each prescribed set, not the
  // prescription itself. Server stores it as the reps for each completed
  // tile so the existing numericValue (sum) drops out of the same JSON.
  const initialCompleted = useMemo(() => {
    const stored = parseSetsState(existing?.textValue ?? null);
    // Map stored reps back to set indices. We take the first N entries
    // that match the prescribed set values in order — good enough for
    // the typical case where the athlete checks tiles left to right.
    const completed = new Set<number>();
    let cursor = 0;
    for (const v of stored) {
      while (cursor < sets.length && sets[cursor] !== v) cursor++;
      if (cursor < sets.length) {
        completed.add(cursor);
        cursor++;
      }
    }
    return completed;
  }, [existing?.textValue, sets]);

  const [completed, setCompleted] = useState<Set<number>>(initialCompleted);

  useEffect(() => {
    setCompleted(initialCompleted);
  }, [initialCompleted]);

  const unit = scoringConfig ? trackScoringUnitLabel(scoringConfig) : "";
  const prescribedTotal = sets.reduce((a, b) => a + b, 0);
  const completedTotal = Array.from(completed).reduce(
    (acc, idx) => acc + sets[idx],
    0
  );

  async function toggleTile(idx: number) {
    const next = new Set(completed);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setCompleted(next);

    const completedSets = sets
      .map((v, i) => (next.has(i) ? v : null))
      .filter((v): v is number => v != null);
    const total = completedSets.reduce((a, b) => a + b, 0);

    try {
      await upsert.mutateAsync({
        numericValue: total,
        textValue: JSON.stringify({ sets: completedSets }),
        isComplete: next.size > 0,
      });
    } catch (err) {
      // Revert on failure so the UI doesn't lie.
      setCompleted(completed);
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  async function markAllDone() {
    const next = new Set(sets.map((_, i) => i));
    setCompleted(next);
    try {
      await upsert.mutateAsync({
        numericValue: prescribedTotal,
        textValue: JSON.stringify({ sets }),
        isComplete: true,
      });
      toast.success("Logged");
    } catch (err) {
      setCompleted(completed);
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-white/10 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center gap-2">
        {sets.map((reps, idx) => {
          const isChecked = completed.has(idx);
          return (
            <button
              key={`${idx}-${reps}`}
              type="button"
              onClick={() => toggleTile(idx)}
              disabled={upsert.isPending}
              className={`flex min-w-[52px] items-center justify-center gap-1 rounded-md border px-3 py-2 text-sm font-semibold transition-colors ${
                isChecked
                  ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300"
                  : "border-white/10 bg-background text-foreground/80 hover:bg-white/[0.04]"
              }`}
              aria-pressed={isChecked}
            >
              {isChecked && <Check className="size-3.5" />}
              {reps}
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          Today: {completedTotal} / {prescribedTotal}
          {unit ? ` ${unit}` : ""} · {label}
          {restHint ? ` · ${restHint}` : ""}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={markAllDone}
          disabled={upsert.isPending || completed.size === sets.length}
          className="border-white/[0.08]"
        >
          Mark all done
        </Button>
      </div>
    </div>
  );
}

function ChallengeFooter({
  trackDayId,
  scoringConfig,
  dayNumber,
  totalDays,
}: {
  trackDayId: string;
  scoringConfig: TrackScoringConfig | null;
  dayNumber?: number | null;
  totalDays?: number | null;
}) {
  const { data: rollup } = useTrackDayRollup(trackDayId);
  if (!rollup) return null;
  const unit = scoringConfig ? trackScoringUnitLabel(scoringConfig) : "";
  const showCumulative = rollup.isCumulative;
  const today = rollup.today.numericValue;
  const parts: string[] = [];
  if (today != null) {
    parts.push(`Today: ${today}${unit ? ` ${unit}` : ""}`);
  }
  if (showCumulative && rollup.sum > 0) {
    parts.push(
      `This challenge: ${rollup.sum}${unit ? ` ${unit}` : ""}`
    );
  }
  if (dayNumber != null && totalDays != null && totalDays > 0) {
    parts.push(`Day ${dayNumber} of ${totalDays}`);
  }
  if (rollup.daysLogged > 0 && showCumulative) {
    parts.push(`Logged: ${rollup.daysLogged}/${rollup.daysAvailable}`);
  }
  if (parts.length === 0) return null;
  return (
    <p className="text-[11px] text-muted-foreground">
      {parts.join(" · ")}
    </p>
  );
}
