"use client";

// Progression generator dialog (spec §2.2). Lives on the track detail
// page. Uses the isomorphic `generateProgression` helper to render a
// live preview, then POSTs to the API which re-runs the same function
// on the server side.

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  generateProgression,
  type DayOfWeek,
  type RestCadence,
} from "@/lib/programming/progression-generator";
import { useGenerateProgression } from "@/hooks/useTracks";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  communityId: string;
  trackId: string;
  startsOn: string;
  endsOn: string;
}

const DOW_LABELS: { value: DayOfWeek; label: string }[] = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

export function ProgressionGeneratorDialog({
  open,
  onOpenChange,
  communityId,
  trackId,
  startsOn,
  endsOn,
}: Props) {
  const [movement, setMovement] = useState("sit-ups");
  const [startReps, setStartReps] = useState("30");
  const [dailyIncrement, setDailyIncrement] = useState("5");
  const [restCadence, setRestCadence] = useState<RestCadence>("everyN");
  const [restEveryN, setRestEveryN] = useState("7");
  const [restDow, setRestDow] = useState<Set<DayOfWeek>>(
    () => new Set<DayOfWeek>([0])
  );
  const [capReps, setCapReps] = useState("");
  const [scoreType, setScoreType] = useState<"reps" | "no_score">("reps");
  const [format, setFormat] = useState("");
  const [overwriteReviewed, setOverwriteReviewed] = useState(false);

  const mutation = useGenerateProgression(communityId, trackId);

  const preview = useMemo(() => {
    try {
      return generateProgression({
        startsOn,
        endsOn,
        movement: movement.trim() || "sit-ups",
        startReps: Number(startReps),
        dailyIncrement: Number(dailyIncrement),
        restCadence,
        restEveryN: restCadence === "everyN" ? Number(restEveryN) : undefined,
        restDaysOfWeek:
          restCadence === "daysOfWeek" ? Array.from(restDow) : undefined,
        capReps: capReps ? Number(capReps) : undefined,
        scoreType,
        format,
      });
    } catch {
      return [];
    }
  }, [
    startsOn,
    endsOn,
    movement,
    startReps,
    dailyIncrement,
    restCadence,
    restEveryN,
    restDow,
    capReps,
    scoreType,
    format,
  ]);

  async function submit() {
    if (!movement.trim()) {
      toast.error("Movement is required");
      return;
    }
    try {
      const res = await mutation.mutateAsync({
        movement: movement.trim(),
        startReps: Number(startReps),
        dailyIncrement: Number(dailyIncrement),
        restCadence,
        restEveryN:
          restCadence === "everyN" ? Number(restEveryN) : undefined,
        restDaysOfWeek:
          restCadence === "daysOfWeek" ? Array.from(restDow) : undefined,
        capReps: capReps ? Number(capReps) : undefined,
        scoreType,
        format,
        overwriteReviewed,
      });
      toast.success(
        `Generated ${res.generated} day(s)${res.skipped ? `, skipped ${res.skipped}` : ""}`
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  function toggleDow(dow: DayOfWeek) {
    setRestDow((prev) => {
      const next = new Set(prev);
      if (next.has(dow)) next.delete(dow);
      else next.add(dow);
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Generate from progression</DialogTitle>
          <DialogDescription>
            Fill in the formula. Rest days emit a &quot;Rest Day!&quot;
            section so athletes know it&apos;s planned, not forgotten.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Movement</Label>
              <Input
                value={movement}
                onChange={(e) => setMovement(e.target.value)}
                placeholder="sit-ups"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Start reps</Label>
                <Input
                  type="number"
                  value={startReps}
                  onChange={(e) => setStartReps(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Daily increment</Label>
                <Input
                  type="number"
                  value={dailyIncrement}
                  onChange={(e) => setDailyIncrement(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Rest cadence</Label>
              <select
                value={restCadence}
                onChange={(e) =>
                  setRestCadence(e.target.value as RestCadence)
                }
                className="w-full rounded-md border border-white/10 bg-background px-2 py-1 text-sm"
              >
                <option value="none">none</option>
                <option value="everyN">every N working days</option>
                <option value="daysOfWeek">specific days of week</option>
              </select>
            </div>
            {restCadence === "everyN" && (
              <div className="space-y-1">
                <Label className="text-xs">Every N working days</Label>
                <Input
                  type="number"
                  min={2}
                  max={14}
                  value={restEveryN}
                  onChange={(e) => setRestEveryN(e.target.value)}
                />
              </div>
            )}
            {restCadence === "daysOfWeek" && (
              <div className="space-y-1">
                <Label className="text-xs">Rest days of week</Label>
                <div className="flex flex-wrap gap-2">
                  {DOW_LABELS.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => toggleDow(d.value)}
                      className={
                        "rounded-md border px-2 py-1 text-xs " +
                        (restDow.has(d.value)
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-white/10 bg-background text-muted-foreground")
                      }
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Cap reps (optional)</Label>
                <Input
                  type="number"
                  value={capReps}
                  onChange={(e) => setCapReps(e.target.value)}
                  placeholder="200"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Score type</Label>
                <select
                  value={scoreType}
                  onChange={(e) =>
                    setScoreType(e.target.value as "reps" | "no_score")
                  }
                  className="w-full rounded-md border border-white/10 bg-background px-2 py-1 text-sm"
                >
                  <option value="reps">reps</option>
                  <option value="no_score">no_score</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Format prefix (optional)</Label>
              <Input
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                placeholder="For time"
              />
            </div>
            <div className="flex items-center justify-between rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5">
              <Label className="text-xs">
                Overwrite already-reviewed days
              </Label>
              <Switch
                checked={overwriteReviewed}
                onCheckedChange={setOverwriteReviewed}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Preview (first 14 days of {preview.length})
            </Label>
            <div className="max-h-80 overflow-y-auto rounded-md border border-white/10 bg-background/30">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1 text-left">Date</th>
                    <th className="px-2 py-1 text-left">Day</th>
                    <th className="px-2 py-1 text-left">Body</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 14).map((row, i) => (
                    <tr
                      key={row.date}
                      className={
                        row.isRestDay
                          ? "bg-amber-500/5 text-amber-300"
                          : i % 2 === 0
                            ? "bg-white/[0.02]"
                            : undefined
                      }
                    >
                      <td className="px-2 py-1 font-mono text-[10px]">
                        {row.date}
                      </td>
                      <td className="px-2 py-1">
                        {row.isRestDay
                          ? "Rest"
                          : `WD ${row.workingDayIndex}`}
                      </td>
                      <td className="px-2 py-1">{row.body}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={mutation.isPending || preview.length === 0}
            onClick={submit}
          >
            {mutation.isPending
              ? "Generating…"
              : `Generate ${preview.length} days`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
