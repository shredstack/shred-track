"use client";

// Renders a per-set weight list like `225 → 235 → 245 → 250   max 250 · e1RM ~262`.
// Max is derived from the list; e1RM uses Brzycki for reps > 1.

interface SetWeightBreakdownProps {
  setWeights: number[];
  repsPerSet?: number;
  unit?: "lb" | "kg";
  className?: string;
}

function brzyckiE1RM(weight: number, reps: number): number {
  if (reps <= 1) return Math.round(weight);
  return Math.round(weight * (36 / (37 - reps)));
}

export function SetWeightBreakdown({
  setWeights,
  repsPerSet,
  unit = "lb",
  className,
}: SetWeightBreakdownProps) {
  const nonZero = setWeights.filter((w) => w > 0);
  if (nonZero.length === 0) return null;

  const max = Math.max(...nonZero);
  const e1rm = repsPerSet && repsPerSet > 1 ? brzyckiE1RM(max, repsPerSet) : null;

  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs ${className ?? ""}`}>
      <div className="flex items-center gap-1 font-mono">
        {setWeights.map((w, i) => {
          const isMax = w === max && w > 0;
          return (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted-foreground/60">→</span>}
              <span
                className={
                  isMax
                    ? "font-semibold text-primary"
                    : w > 0
                      ? "text-foreground"
                      : "text-muted-foreground/50"
                }
              >
                {w > 0 ? w : "—"}
              </span>
            </span>
          );
        })}
      </div>
      <span className="text-muted-foreground">
        max {max} {unit}
        {e1rm !== null && ` · e1RM ~${e1rm} ${unit}`}
      </span>
    </div>
  );
}
