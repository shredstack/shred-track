"use client";

// Per-track scoring config editor (spec §3.4). Lives on the track detail
// page and writes into `programming_tracks.scoring_config`.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  TRACK_SCORING_AGGREGATIONS,
  TRACK_SCORING_UNITS,
  type TrackScoringAggregation,
  type TrackScoringConfig,
  type TrackScoringUnit,
} from "@/types/programming-tracks";

const AGG_HELP: Record<TrackScoringAggregation, string> = {
  sum: "Total across all days. Best for cumulative challenges (\"1,200 sit-ups this month\").",
  last: "Latest entry wins. Best for ongoing measures (\"current weight: 195 lb\").",
  per_day_independent:
    "Each day stands alone. Default for monthly challenges.",
  streak:
    "Rank by days completed. Best for habit challenges (\"log every day\").",
};

interface Props {
  initial: TrackScoringConfig | null;
  onSave: (config: TrackScoringConfig | null) => Promise<void> | void;
  saving?: boolean;
}

export function TrackScoringConfigEditor({ initial, onSave, saving }: Props) {
  const [enabled, setEnabled] = useState<boolean>(initial != null);
  const [unit, setUnit] = useState<TrackScoringUnit>(initial?.unit ?? "reps");
  const [unitLabel, setUnitLabel] = useState<string>(initial?.unitLabel ?? "");
  const [dailyTarget, setDailyTarget] = useState<string>(
    initial?.dailyTarget != null ? String(initial.dailyTarget) : ""
  );
  const [aggregation, setAggregation] = useState<TrackScoringAggregation>(
    initial?.aggregation ?? "per_day_independent"
  );
  const [allowJustDone, setAllowJustDone] = useState<boolean>(
    initial?.allowJustDone === true
  );
  const [description, setDescription] = useState<string>(
    initial?.description ?? ""
  );

  // Resync when the parent supplies a different track.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setEnabled(initial != null);
    setUnit(initial?.unit ?? "reps");
    setUnitLabel(initial?.unitLabel ?? "");
    setDailyTarget(
      initial?.dailyTarget != null ? String(initial.dailyTarget) : ""
    );
    setAggregation(initial?.aggregation ?? "per_day_independent");
    setAllowJustDone(initial?.allowJustDone === true);
    setDescription(initial?.description ?? "");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [initial]);

  async function handleSave() {
    if (!enabled) {
      await onSave(null);
      return;
    }
    const dt = dailyTarget.trim() ? Number(dailyTarget) : undefined;
    const config: TrackScoringConfig = {
      unit,
      aggregation,
      ...(unit === "custom" && unitLabel.trim()
        ? { unitLabel: unitLabel.trim() }
        : {}),
      ...(dt != null && Number.isFinite(dt) ? { dailyTarget: dt } : {}),
      ...(allowJustDone ? { allowJustDone: true } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
    };
    await onSave(config);
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Scoring</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">
            Enable per-day scoring
          </Label>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        {enabled && (
          <>
            <div className="grid grid-cols-2 gap-3">
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
                <div className="space-y-1">
                  <Label className="text-xs">Unit label</Label>
                  <Input
                    value={unitLabel}
                    onChange={(e) => setUnitLabel(e.target.value)}
                    placeholder="g of fruits/veg"
                  />
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs">Daily target (optional)</Label>
                <Input
                  type="number"
                  value={dailyTarget}
                  onChange={(e) => setDailyTarget(e.target.value)}
                  placeholder="30"
                />
              </div>
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
                {TRACK_SCORING_AGGREGATIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground">
                {AGG_HELP[aggregation]}
              </p>
            </div>

            <div className="flex items-center justify-between">
              <Label className="text-xs">
                Allow &quot;Mark done&quot; without a number
              </Label>
              <Switch
                checked={allowJustDone}
                onCheckedChange={setAllowJustDone}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Description (shown to athlete)</Label>
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Log your daily total."
              />
            </div>
          </>
        )}

        <Button size="sm" onClick={handleSave} disabled={!!saving}>
          {saving ? "Saving…" : "Save scoring"}
        </Button>
      </CardContent>
    </Card>
  );
}
