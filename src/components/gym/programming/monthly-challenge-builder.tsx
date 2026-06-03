"use client";

// Monthly Challenge Builder (spec §3.1).
//
// One-screen authoring for the common monthly-challenge patterns.
// Pure UI + a single mutation that hits POST .../seed-from-builder.
//
// Embedded on track creation flow (kind === "monthly_challenge", before
// or right after track creation) and on the track detail page as the
// "Re-run Builder" sheet. The destructive-overwrite confirm dialog is
// the responsibility of the caller — this component is just the form.

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  generateBuilderDays,
  type BuilderPattern,
} from "@/lib/programming/challenge-builder";
import {
  TRACK_SCORING_UNITS,
  type TrackBuilderMarkDoneStyle,
  type TrackBuilderRestCadence,
  type TrackScoringAggregation,
  type TrackScoringConfig,
  type TrackScoringUnit,
} from "@/types/programming-tracks";

export interface BuilderSubmitPayload {
  pattern: BuilderPattern;
  unit: TrackScoringUnit;
  unitLabel?: string;
  label: string;
  restCadence: TrackBuilderRestCadence;
  restDayLabel?: string;
  markDoneStyle: TrackBuilderMarkDoneStyle;
  aggregation: TrackScoringAggregation;
  description?: string;
  dailyTarget?: number;
}

interface Props {
  startsOn: string;
  endsOn: string;
  /** Existing scoring config — used to pre-fill on "Re-run Builder". */
  initial?: TrackScoringConfig | null;
  /** Default label suggestion (e.g. the track's name minus "Challenge"). */
  defaultLabel?: string;
  onSubmit: (payload: BuilderSubmitPayload) => Promise<void> | void;
  submitting?: boolean;
  submitLabel?: string;
}

type PatternKind = "flat" | "ladder" | "per_day";

function inferRestCadenceLabel(c: TrackBuilderRestCadence): string {
  switch (c) {
    case "none":
      return "No rest days";
    case "every_7th":
      return "Every 7th day";
    case "weekends":
      return "Weekends (Sat/Sun)";
  }
}

function inferMarkDoneLabel(m: TrackBuilderMarkDoneStyle): string {
  switch (m) {
    case "prefilled":
      return "Pre-filled prescription";
    case "free_entry":
      return "Free entry";
    case "checkbox":
      return "Just a checkbox";
  }
}

function inferAggregationLabel(a: TrackScoringAggregation): string {
  switch (a) {
    case "sum":
      return "Sum across days";
    case "streak":
      return "Days completed (streak)";
    case "last":
      return "Last value";
    case "per_day_independent":
      return "Each day independent";
  }
}

function listDates(startsOn: string, endsOn: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) return [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) return [];
  const start = new Date(`${startsOn}T00:00:00Z`).getTime();
  const end = new Date(`${endsOn}T00:00:00Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];
  const out: string[] = [];
  const total = Math.round((end - start) / 86_400_000) + 1;
  for (let i = 0; i < total; i++) {
    out.push(new Date(start + i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

export function MonthlyChallengeBuilder({
  startsOn,
  endsOn,
  initial,
  defaultLabel,
  onSubmit,
  submitting,
  submitLabel,
}: Props) {
  const allDates = useMemo(() => listDates(startsOn, endsOn), [startsOn, endsOn]);

  const seededPattern = initial?.builderPattern ?? null;
  const seededKind: PatternKind = seededPattern?.kind ?? "flat";

  const [label, setLabel] = useState<string>(defaultLabel ?? "");
  const [unit, setUnit] = useState<TrackScoringUnit>(initial?.unit ?? "reps");
  const [unitLabel, setUnitLabel] = useState<string>(initial?.unitLabel ?? "");
  const [patternKind, setPatternKind] = useState<PatternKind>(seededKind);

  // Flat
  const [flatAmount, setFlatAmount] = useState<string>(
    seededPattern?.kind === "flat" ? String(seededPattern.dailyAmount) : "10"
  );

  // Ladder
  const [ladderStart, setLadderStart] = useState<string>(
    seededPattern?.kind === "ladder" ? String(seededPattern.startAmount) : "10"
  );
  const [ladderInc, setLadderInc] = useState<string>(
    seededPattern?.kind === "ladder"
      ? String(seededPattern.incrementPerDay)
      : "1"
  );
  const [ladderWeekly, setLadderWeekly] = useState<string>(
    seededPattern?.kind === "ladder" ? String(seededPattern.weeklyBonus) : "0"
  );

  // Per-day
  const [perDayRows, setPerDayRows] = useState<
    Array<{ date: string; setsText: string; restHint: string }>
  >(() =>
    allDates.map((d) => ({ date: d, setsText: "", restHint: "" }))
  );

  // Misc
  const [restCadence, setRestCadence] = useState<TrackBuilderRestCadence>(
    initial?.restCadence ?? "none"
  );
  const [restDayLabel, setRestDayLabel] = useState<string>(
    initial?.restDayLabel ?? "Rest day"
  );
  const [markDoneStyle, setMarkDoneStyle] = useState<TrackBuilderMarkDoneStyle>(
    initial?.checkboxOnly
      ? "checkbox"
      : initial?.allowJustDone
        ? "prefilled"
        : "prefilled"
  );
  const [aggregation, setAggregation] = useState<TrackScoringAggregation>(
    initial?.aggregation ?? "sum"
  );
  const [description, setDescription] = useState<string>(
    initial?.description ?? ""
  );
  const [dailyTarget, setDailyTarget] = useState<string>(
    initial?.dailyTarget != null ? String(initial.dailyTarget) : ""
  );

  const builderPattern: BuilderPattern | null = useMemo(() => {
    if (patternKind === "flat") {
      const v = Number(flatAmount);
      if (!Number.isFinite(v)) return null;
      return { kind: "flat", dailyAmount: v };
    }
    if (patternKind === "ladder") {
      const s = Number(ladderStart);
      const i = Number(ladderInc);
      const w = Number(ladderWeekly || "0");
      if (!Number.isFinite(s) || !Number.isFinite(i) || !Number.isFinite(w)) {
        return null;
      }
      return {
        kind: "ladder",
        startAmount: s,
        incrementPerDay: i,
        weeklyBonus: w,
      };
    }
    const daysSets = perDayRows.map((row) => {
      const sets = row.setsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n) && n >= 0);
      return {
        date: row.date,
        sets,
        ...(row.restHint.trim() ? { restHint: row.restHint.trim() } : {}),
      };
    });
    return { kind: "per_day", daysSets };
  }, [
    patternKind,
    flatAmount,
    ladderStart,
    ladderInc,
    ladderWeekly,
    perDayRows,
  ]);

  const preview = useMemo(() => {
    if (!builderPattern || !label.trim()) return [];
    try {
      return generateBuilderDays({
        startsOn,
        endsOn,
        label: label.trim(),
        pattern: builderPattern,
        restCadence,
        restDayLabel,
      }).slice(0, 7);
    } catch {
      return [];
    }
  }, [
    builderPattern,
    label,
    startsOn,
    endsOn,
    restCadence,
    restDayLabel,
  ]);

  async function handleSubmit() {
    if (!label.trim()) {
      toast.error("Movement / metric label is required");
      return;
    }
    if (!builderPattern) {
      toast.error("Pattern is incomplete");
      return;
    }
    const payload: BuilderSubmitPayload = {
      pattern: builderPattern,
      unit,
      ...(unitLabel.trim() ? { unitLabel: unitLabel.trim() } : {}),
      label: label.trim(),
      restCadence,
      ...(restDayLabel.trim() ? { restDayLabel: restDayLabel.trim() } : {}),
      markDoneStyle,
      aggregation,
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(dailyTarget.trim() && Number.isFinite(Number(dailyTarget))
        ? { dailyTarget: Number(dailyTarget) }
        : {}),
    };
    await onSubmit(payload);
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Sparkles className="size-3.5" />
          Challenge Builder
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Movement / metric</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Burpees"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Unit</Label>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as TrackScoringUnit)}
              className="w-full rounded-md border border-white/10 bg-background px-2 py-1 text-sm"
            >
              {TRACK_SCORING_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
          {unit === "custom" && (
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Unit label</Label>
              <Input
                value={unitLabel}
                onChange={(e) => setUnitLabel(e.target.value)}
                placeholder="g of fruits/veg"
              />
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Pattern</Label>
          <div className="flex flex-wrap gap-2">
            {(["flat", "ladder", "per_day"] as PatternKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setPatternKind(k)}
                className={`rounded-md border px-3 py-1 text-xs ${
                  patternKind === k
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-white/10 bg-background text-foreground/80"
                }`}
              >
                {k === "flat"
                  ? "Flat"
                  : k === "ladder"
                    ? "Ladder"
                    : "Per-day"}
              </button>
            ))}
          </div>
        </div>

        {patternKind === "flat" && (
          <div className="space-y-1">
            <Label className="text-xs">Daily amount</Label>
            <Input
              type="number"
              value={flatAmount}
              onChange={(e) => setFlatAmount(e.target.value)}
              placeholder="800"
              className="max-w-[140px]"
            />
          </div>
        )}

        {patternKind === "ladder" && (
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Start amount</Label>
              <Input
                type="number"
                value={ladderStart}
                onChange={(e) => setLadderStart(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">+ Per day</Label>
              <Input
                type="number"
                value={ladderInc}
                onChange={(e) => setLadderInc(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Weekly bonus</Label>
              <Input
                type="number"
                value={ladderWeekly}
                onChange={(e) => setLadderWeekly(e.target.value)}
              />
            </div>
          </div>
        )}

        {patternKind === "per_day" && (
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">
              Type comma-separated reps per row, e.g. <code>6, 4, 3, 3</code>.
              An optional rest hint appears in the body.
            </p>
            <div className="max-h-[260px] overflow-y-auto space-y-1.5 rounded-md border border-white/10 p-2">
              {perDayRows.map((row, idx) => (
                <div
                  key={row.date}
                  className="grid grid-cols-[80px_1fr_120px] items-center gap-2"
                >
                  <span className="text-[11px] text-muted-foreground">
                    {row.date.slice(5)}
                  </span>
                  <Input
                    value={row.setsText}
                    placeholder="6, 4, 3, 3"
                    onChange={(e) => {
                      const v = e.target.value;
                      setPerDayRows((rows) => {
                        const next = [...rows];
                        next[idx] = { ...next[idx], setsText: v };
                        return next;
                      });
                    }}
                    className="h-7 text-xs"
                  />
                  <Input
                    value={row.restHint}
                    placeholder="rest :20"
                    onChange={(e) => {
                      const v = e.target.value;
                      setPerDayRows((rows) => {
                        const next = [...rows];
                        next[idx] = { ...next[idx], restHint: v };
                        return next;
                      });
                    }}
                    className="h-7 text-xs"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Rest cadence</Label>
            <select
              value={restCadence}
              onChange={(e) =>
                setRestCadence(e.target.value as TrackBuilderRestCadence)
              }
              className="w-full rounded-md border border-white/10 bg-background px-2 py-1 text-sm"
            >
              {(["none", "every_7th", "weekends"] as TrackBuilderRestCadence[]).map(
                (c) => (
                  <option key={c} value={c}>
                    {inferRestCadenceLabel(c)}
                  </option>
                )
              )}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Rest day label</Label>
            <Input
              value={restDayLabel}
              onChange={(e) => setRestDayLabel(e.target.value)}
              placeholder="Rest day"
              disabled={restCadence === "none"}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Mark-done style</Label>
            <select
              value={markDoneStyle}
              onChange={(e) =>
                setMarkDoneStyle(e.target.value as TrackBuilderMarkDoneStyle)
              }
              className="w-full rounded-md border border-white/10 bg-background px-2 py-1 text-sm"
            >
              {(
                ["prefilled", "free_entry", "checkbox"] as TrackBuilderMarkDoneStyle[]
              ).map((m) => (
                <option key={m} value={m}>
                  {inferMarkDoneLabel(m)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Aggregation</Label>
            <select
              value={aggregation}
              onChange={(e) =>
                setAggregation(e.target.value as TrackScoringAggregation)
              }
              className="w-full rounded-md border border-white/10 bg-background px-2 py-1 text-sm"
            >
              {(
                ["sum", "streak", "last", "per_day_independent"] as TrackScoringAggregation[]
              ).map((a) => (
                <option key={a} value={a}>
                  {inferAggregationLabel(a)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Daily target (optional)</Label>
            <Input
              type="number"
              value={dailyTarget}
              onChange={(e) => setDailyTarget(e.target.value)}
              placeholder=""
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Description (optional)</Label>
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Log your daily total."
          />
        </div>

        {preview.length > 0 && (
          <div className="rounded-md border border-white/10 bg-white/[0.02] p-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              Preview · first 7 days
            </p>
            <ul className="space-y-0.5">
              {preview.map((p) => (
                <li
                  key={p.date}
                  className="text-[11px] flex items-center gap-2"
                >
                  <span className="text-muted-foreground tabular-nums w-[68px]">
                    {p.date.slice(5)}
                  </span>
                  <span
                    className={
                      p.isRestDay
                        ? "italic text-muted-foreground"
                        : "text-foreground/85"
                    }
                  >
                    {p.body}
                  </span>
                  {p.prescribedValue != null && (
                    <span className="text-muted-foreground ml-auto tabular-nums">
                      {p.prescribedValue}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!!submitting || !label.trim()}
        >
          {submitting ? "Saving…" : submitLabel || "Build challenge"}
        </Button>
      </CardContent>
    </Card>
  );
}
