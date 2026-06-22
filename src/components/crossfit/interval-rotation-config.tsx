"use client";

import { Label } from "@/components/ui/label";
import type { WorkoutBuilderMovement } from "@/types/crossfit";

interface IntervalRotationConfigProps {
  movements: WorkoutBuilderMovement[];
  onMovementsChange: (movements: WorkoutBuilderMovement[]) => void;
  /** Whether the rotation UI is active. Controlled by the parent so the
   *  per-movement Round selectors (rendered down in the movement list) stay
   *  in sync with this panel's "Rotate movements" checkbox. */
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  /** How many "Round N" slots a movement can be pinned to. Computed by the
   *  parent from the part's round count (and any already-pinned slots). */
  roundCount: number;
  compact?: boolean;
}

// Per-round movement assignment for the "intervals" workout type. Unlike the
// rotating EMOM (where every movement gets a slot and the cycle repeats), an
// intervals rotation runs each round exactly once, so:
//   - slotIndex == null  → the movement is performed EVERY round (a constant,
//     e.g. a 200m run buy-in that repeats each round).
//   - slotIndex == N     → the movement is performed only in round N+1.
// This is what lets a coach build "On a 20:00 clock, 4 × 5:00: 200m run +
// a different max-rep gymnastics movement each round." The run stays "every
// round"; each gymnastics skill is pinned to its round.
export function IntervalRotationConfig({
  movements,
  onMovementsChange,
  enabled,
  onEnabledChange,
  roundCount,
  compact = false,
}: IntervalRotationConfigProps) {
  const labelClass = compact ? "text-xs text-muted-foreground" : "text-sm";

  // Rotation is persisted purely via per-movement `slotIndex`; the parent
  // folds the explicit "user turned it on" intent together with whether any
  // movement already carries a slot into `enabled`.
  const rotating = enabled;

  const disable = () => {
    onEnabledChange(false);
    onMovementsChange(movements.map((m) => ({ ...m, slotIndex: null })));
  };

  const setRound = (tempId: string, slotIndex: number | null) => {
    onMovementsChange(
      movements.map((m) => (m.tempId === tempId ? { ...m, slotIndex } : m))
    );
  };

  return (
    <div className="space-y-2 rounded-md border border-border/40 bg-muted/15 p-2">
      <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
        <input
          type="checkbox"
          checked={rotating}
          onChange={(e) =>
            e.target.checked ? onEnabledChange(true) : disable()
          }
          className="size-3 cursor-pointer"
        />
        Rotate movements (a different movement each round)
      </label>

      {rotating && (
        <div className="space-y-2 pt-1">
          <p className="text-[11px] text-muted-foreground">
            Pin each movement to a round, or leave it on{" "}
            <span className="font-medium">Every round</span> for movements done
            in every round (e.g. a run buy-in).
          </p>

          {movements.length === 0 ? (
            <p className="text-[11px] italic text-muted-foreground">
              Add movements below, then choose each one&rsquo;s round here.
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
                    <Label className={`${labelClass} text-[10px]`}>Round</Label>
                    <select
                      value={m.slotIndex != null ? String(m.slotIndex) : ""}
                      onChange={(e) =>
                        setRound(
                          m.tempId,
                          e.target.value === ""
                            ? null
                            : parseInt(e.target.value, 10)
                        )
                      }
                      className="h-7 rounded-md border border-input bg-background px-1.5 text-xs"
                      aria-label={`${m.movementName || "Movement"} round`}
                    >
                      <option value="">Every</option>
                      {Array.from({ length: roundCount }, (_, i) => (
                        <option key={i} value={String(i)}>
                          {i + 1}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
