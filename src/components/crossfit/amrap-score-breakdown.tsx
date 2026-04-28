"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Check, X } from "lucide-react";
import { decomposeAmrapScore } from "@/lib/crossfit/score-decomposition";
import type { WorkoutPartDisplay, ScoreDisplay } from "@/types/crossfit";
import { useUserProfile } from "@/hooks/useProfile";

interface AmrapScoreBreakdownProps {
  part: WorkoutPartDisplay;
  score: ScoreDisplay;
}

/**
 * Round-by-round disclosure for an AMRAP score. Renders nothing when
 * decomposition isn't possible (no parsed shapes / non-AMRAP / no rounds).
 *
 * Defaults collapsed; tap the summary to expand. Works on the client only —
 * uses the user-profile query for gender resolution.
 */
export function AmrapScoreBreakdown({ part, score }: AmrapScoreBreakdownProps) {
  const [open, setOpen] = useState(false);
  const { data: profile } = useUserProfile();

  const gender = useMemo(() => {
    if (profile?.gender === "male") return "M" as const;
    if (profile?.gender === "female") return "F" as const;
    return null;
  }, [profile?.gender]);

  const decomposed = useMemo(
    () => decomposeAmrapScore(part, score, gender),
    [part, score, gender]
  );

  if (!decomposed) return null;
  if (decomposed.rounds.length === 0) return null;

  return (
    <div className="rounded-md border border-white/[0.04] bg-white/[0.01]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 px-2.5 py-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground"
      >
        <ChevronRight
          className={`size-3 transition-transform ${open ? "rotate-90" : ""}`}
        />
        Round breakdown
        {decomposed.genderUncertain && (
          <span className="ml-1 text-[10px] text-amber-400/80">
            (gender unset — using fallback)
          </span>
        )}
      </button>
      {open && (
        <div className="space-y-1 border-t border-white/[0.04] px-2.5 py-2 text-[11px]">
          {decomposed.rounds.map((r) => (
            <div
              key={r.roundIndex}
              className="flex items-center gap-2 font-mono"
            >
              <span className="w-12 text-muted-foreground">
                Round {r.roundIndex + 1}
              </span>
              {r.full ? (
                <Check className="size-3 text-emerald-400" />
              ) : (
                <X className="size-3 text-amber-400" />
              )}
              <span className="flex-1 text-foreground/85">
                {r.movements
                  .map((m) =>
                    m.completed === m.prescribed
                      ? formatQuantity(m.completed, m.unit, m.movementName)
                      : `${m.completed}${m.prescribed ? `/${m.prescribed}` : ""} ${unitSuffix(m.unit, m.movementName)}`
                  )
                  .join(" + ")}
                {!r.full && (
                  <span className="ml-1.5 text-amber-400/80">(stopped)</span>
                )}
              </span>
            </div>
          ))}
          {decomposed.perMovementTotals.length > 0 && (
            <div className="mt-1.5 flex items-center gap-2 border-t border-white/[0.04] pt-1.5 font-mono">
              <span className="w-12 text-muted-foreground">Totals</span>
              <span className="text-foreground/85">
                {decomposed.perMovementTotals
                  .map((t) =>
                    formatQuantity(t.total, t.unit, t.movementName, true)
                  )
                  .join(" · ")}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// "12 cal Row" / "36 C2B" style. When `withName` is true, includes the
// movement name (used in totals row); otherwise drops it (already implied
// by the per-round listing).
function formatQuantity(
  value: number,
  unit: "reps" | "cal" | "m",
  movementName: string,
  withName = false
): string {
  const suffix = unitSuffix(unit, movementName);
  if (withName) return `${value} ${suffix}`.trim();
  return suffix.endsWith(movementName) ? `${value} ${suffix}` : `${value} ${suffix}`;
}

function unitSuffix(
  unit: "reps" | "cal" | "m",
  movementName: string
): string {
  if (unit === "cal") return `cal ${movementName}`;
  if (unit === "m") return `m ${movementName}`;
  return movementName;
}
