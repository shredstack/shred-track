"use client";

// Renders a per-set weight list like
// `225 → 235 → 245×3@8 → 250×2@9   max 250 · e1RM ~262`.
// Per-set reps are read off each entry; if entries omit reps, falls back to
// `repsPerSet` for the e1RM calculation. Max is derived from the list.
// Reps suffix (`×N`) only renders when reps vary across sets, to keep the
// uniform case clean. RPE suffix (`@N`) renders whenever present.

import type { SetEntry } from "@/types/crossfit";
import { qualifyingTopSetWeight } from "@/lib/crossfit/set-entries";

interface SetWeightBreakdownProps {
  entries: SetEntry[];
  repsPerSet?: number;
  // Full prescribed rep scheme (e.g. "5-5-5-5-5"). When provided, the "max"
  // label reflects the heaviest set that met its prescription — matching the
  // stored top-set score — rather than the raw heaviest weight touched.
  repScheme?: string | null;
  unit?: "lb" | "kg";
  className?: string;
}

function brzyckiE1RM(weight: number, reps: number): number {
  if (reps <= 1) return Math.round(weight);
  return Math.round(weight * (36 / (37 - reps)));
}

export function SetWeightBreakdown({
  entries,
  repsPerSet,
  repScheme,
  unit = "lb",
  className,
}: SetWeightBreakdownProps) {
  const nonZero = entries.filter((e) => e.weight > 0);
  if (nonZero.length === 0) return null;

  // The "best" set for e1RM is the one whose Brzycki estimate is highest —
  // not just the heaviest weight. A 225×5 beats a 245×2 for predicting 1RM.
  let bestE1rm = 0;
  let bestEntry: SetEntry | null = null;
  for (const e of nonZero) {
    const reps = e.reps ?? repsPerSet ?? 1;
    const est = brzyckiE1RM(e.weight, reps);
    if (est > bestE1rm) {
      bestE1rm = est;
      bestEntry = e;
    }
  }

  // "max" = the top set that counts as the score. With a known scheme that's
  // the heaviest set that met its prescribed reps (a failed set doesn't win);
  // without one it's simply the heaviest weight touched.
  const max = qualifyingTopSetWeight(entries, repScheme);
  const repsVary = nonZero.some(
    (e, _i, arr) => e.reps != null && e.reps !== arr[0].reps
  );

  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs ${className ?? ""}`}>
      <div className="flex items-center gap-1 font-mono">
        {entries.map((e, i) => {
          const isBest = bestEntry === e && e.weight > 0;
          return (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted-foreground/60">→</span>}
              <span
                className={
                  isBest
                    ? "font-semibold text-primary"
                    : e.weight > 0
                      ? "text-foreground"
                      : "text-muted-foreground/50"
                }
              >
                {e.weight > 0 ? e.weight : "—"}
                {repsVary && e.reps != null && e.weight > 0 && (
                  <span className="text-muted-foreground/70">×{e.reps}</span>
                )}
                {e.rpe != null && e.weight > 0 && (
                  <span className="text-muted-foreground/70">@{e.rpe}</span>
                )}
              </span>
            </span>
          );
        })}
      </div>
      <span className="text-muted-foreground">
        max {max} {unit}
        {bestE1rm > max && ` · e1RM ~${bestE1rm} ${unit}`}
      </span>
    </div>
  );
}
