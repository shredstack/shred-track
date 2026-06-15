"use client";

import { useEffect, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseDurationToSeconds } from "@/lib/crossfit/duration-parser";
import type { WorkoutBuilderMovement } from "@/types/crossfit";

interface EmomRotationConfigProps {
  movements: WorkoutBuilderMovement[];
  onMovementsChange: (movements: WorkoutBuilderMovement[]) => void;
  /** EMOM total duration (mm:ss) — maps to timeCapSeconds. */
  timeCapInput: string;
  /** Per-minute interval (mm:ss) — maps to emomIntervalSeconds. */
  emomIntervalInput: string;
  compact?: boolean;
}

// Rotating EMOM editor. A rotating EMOM assigns movement(s) to each minute of
// a repeating cycle (e.g. "EMOM 20: Min 1 max pull-ups / Min 2 max ring dips /
// Min 3 max sit-ups / Min 4 rest"); the cycle repeats to fill the EMOM
// duration. Rotation is stored as a per-movement `slotIndex` (0-based minute);
// the presence of any slotIndex is what marks the part as rotating. The cycle
// length is derived as max(slotIndex)+1 and the number of cycles (= score-entry
// rounds) as timeCap / (cycleLength × interval). A minute with no movement
// (a gap, or one holding only the "Rest" movement) is a rest minute.
export function EmomRotationConfig({
  movements,
  onMovementsChange,
  timeCapInput,
  emomIntervalInput,
  compact = false,
}: EmomRotationConfigProps) {
  const labelClass = compact ? "text-xs text-muted-foreground" : "text-sm";
  const rotating = movements.some((m) => m.slotIndex != null);

  // Keep slotIndex populated on every movement while rotating so the cycle
  // length and minute labels stay correct as movements are added below. A
  // freshly-added movement (slotIndex null) defaults to its own next minute.
  useEffect(() => {
    if (!rotating) return;
    let nextFree = movements.reduce(
      (mx, m) => (m.slotIndex != null ? Math.max(mx, m.slotIndex) : mx),
      -1
    );
    let changed = false;
    const filled = movements.map((m) => {
      if (m.slotIndex != null) return m;
      nextFree += 1;
      changed = true;
      return { ...m, slotIndex: nextFree };
    });
    if (changed) onMovementsChange(filled);
  }, [rotating, movements, onMovementsChange]);

  const cycleLength = useMemo(
    () =>
      movements.reduce(
        (mx, m) => (m.slotIndex != null ? Math.max(mx, m.slotIndex) : mx),
        -1
      ) + 1,
    [movements]
  );

  const cycles = useMemo(() => {
    const total = parseDurationToSeconds(timeCapInput);
    const interval = parseDurationToSeconds(emomIntervalInput);
    if (!total || !interval || cycleLength <= 0) return null;
    const c = Math.floor(total / (interval * cycleLength));
    return c > 0 ? c : null;
  }, [timeCapInput, emomIntervalInput, cycleLength]);

  const enable = () =>
    onMovementsChange(movements.map((m, i) => ({ ...m, slotIndex: i })));
  const disable = () =>
    onMovementsChange(movements.map((m) => ({ ...m, slotIndex: null })));

  const setMinute = (tempId: string, minute1Based: number) => {
    const slot = Math.max(0, minute1Based - 1);
    onMovementsChange(
      movements.map((m) =>
        m.tempId === tempId ? { ...m, slotIndex: slot } : m
      )
    );
  };

  return (
    <div className="space-y-2 rounded-md border border-border/40 bg-muted/15 p-2">
      <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
        <input
          type="checkbox"
          checked={rotating}
          onChange={(e) => (e.target.checked ? enable() : disable())}
          className="size-3 cursor-pointer"
        />
        Rotating EMOM (a different movement each minute)
      </label>

      {rotating && (
        <div className="space-y-2 pt-1">
          <p className="text-[11px] text-muted-foreground">
            Assign each movement to a minute of the cycle. Movements sharing a
            minute are done together. For a rest minute, add the &ldquo;Rest&rdquo;
            movement below and give it its own minute.
          </p>

          {movements.length === 0 ? (
            <p className="text-[11px] italic text-muted-foreground">
              Add movements below, then set each one&rsquo;s minute here.
            </p>
          ) : (
            <div className="space-y-1.5">
              {movements.map((m) => (
                <div
                  key={m.tempId}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="truncate text-xs">
                    {m.movementName || "Movement"}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <Label className={`${labelClass} text-[10px]`}>Min</Label>
                    <Input
                      type="number"
                      min={1}
                      value={m.slotIndex != null ? m.slotIndex + 1 : ""}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        if (Number.isFinite(n) && n >= 1) {
                          setMinute(m.tempId, n);
                        }
                      }}
                      className="h-7 w-14 text-center"
                      aria-label={`${m.movementName || "Movement"} minute`}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="text-[11px] font-medium text-muted-foreground">
            {cycleLength > 0
              ? `${cycleLength}-minute cycle${
                  cycles ? ` × ${cycles} round${cycles === 1 ? "" : "s"}` : ""
                }`
              : "Set the EMOM duration and interval to see the cycle count."}
          </p>
        </div>
      )}
    </div>
  );
}
