"use client";

import { Badge } from "@/components/ui/badge";
import { SetWeightBreakdown } from "@/components/crossfit/set-weight-breakdown";
import { formatTime } from "@/lib/workout-parser";
import type { SetEntry } from "@/types/crossfit";

// ---------------------------------------------------------------------------
// MovementScalingRow
//
// One row per (score, movement). Renders an Rx badge when the athlete hit
// the prescription verbatim, otherwise lists every dimension along which
// they actually scaled — modification, substitution, weight, reps,
// duration, height, per-round arrays, and per-set entries.
//
// Used by the template-history sheet and the leaderboard's expanded
// scaling-details panel. Keep the visual style in sync with the
// leaderboard (yellow tint for scaled, emerald for Rx).
// ---------------------------------------------------------------------------

export interface MovementScalingDetail {
  movementName: string | null;
  wasRx: boolean;
  /** Single working weight (lb) for movements scored at one load. */
  actualWeightLb?: number | null;
  /** Free-text reps the athlete completed (e.g. "10" for a scaled rep
   *  count, "21-15-9" for a logged ladder). */
  actualReps?: string | null;
  /** Modification text typed by the athlete ("knee push-ups",
   *  "ring rows", etc.). */
  modification?: string | null;
  /** Substituted movement's canonical name. */
  substitutionName?: string | null;
  /** Per-set entries on for_load parts. */
  setEntries?: SetEntry[] | null;
  /** Held duration for a static-hold scaled value (e.g. "L-sit :22"). */
  actualDurationSeconds?: number | null;
  /** Box jump / deficit pushup actual height. */
  actualHeightInches?: number | null;
  /** Max-reps movement: rep count per round. */
  actualRepsPerRound?: number[] | null;
  /** Per-round duration capture (e.g. 3 × Run 400m timed). */
  actualDurationSecondsPerRound?: number[] | null;
  /** Athlete-picked-weight movements: lb per round. */
  actualWeightLbsPerRound?: number[] | null;
}

const RX_BADGE_CLASSES =
  "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[10px]";
const SCALED_BADGE_CLASSES =
  "border-yellow-500/30 bg-yellow-500/10 text-yellow-400 text-[10px]";

export function MovementScalingRow({
  detail,
  /** Optional `variant` lets the leaderboard use a more compact layout
   *  while the history sheet can show more detail per row. Defaults to
   *  "detailed" — used by the history sheet. */
  variant = "detailed",
}: {
  detail: MovementScalingDetail;
  variant?: "compact" | "detailed";
}) {
  const name = detail.movementName ?? "Movement";
  const summary = buildScaledSummary(detail);
  const hasPerRound =
    (detail.actualRepsPerRound && detail.actualRepsPerRound.length > 0) ||
    (detail.actualDurationSecondsPerRound &&
      detail.actualDurationSecondsPerRound.length > 0) ||
    (detail.actualWeightLbsPerRound &&
      detail.actualWeightLbsPerRound.length > 0);
  const hasSetEntries = !!detail.setEntries && detail.setEntries.length > 0;

  // Compact: one-line summary used by the leaderboard. No set/per-round
  // breakdown; the leaderboard intentionally keeps that compact.
  if (variant === "compact") {
    return (
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{name}</span>
        <div className="flex items-center gap-2">
          {detail.wasRx ? (
            <Badge variant="outline" className={RX_BADGE_CLASSES}>
              Rx
            </Badge>
          ) : (
            <span className="text-yellow-400">{summary ?? "Scaled"}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-foreground/90">{name}</span>
        {detail.wasRx ? (
          <Badge variant="outline" className={RX_BADGE_CLASSES}>
            Rx
          </Badge>
        ) : (
          <Badge variant="outline" className={SCALED_BADGE_CLASSES}>
            Scaled
          </Badge>
        )}
      </div>

      {!detail.wasRx && summary && (
        <p className="text-xs text-yellow-200/90">{summary}</p>
      )}

      {hasSetEntries && (
        <div className="pt-0.5">
          <SetWeightBreakdown entries={detail.setEntries!} />
        </div>
      )}

      {hasPerRound && (
        <PerRoundBreakdown detail={detail} />
      )}

      {/* Rx + actual weight pair: athlete-picked-weight movements log a
          working weight even when wasRx is true. Surface it so the row
          isn't a content-free "Rx" badge with no number. */}
      {detail.wasRx && !hasSetEntries && !hasPerRound && summary && (
        <p className="text-xs text-muted-foreground">{summary}</p>
      )}
    </div>
  );
}

function PerRoundBreakdown({ detail }: { detail: MovementScalingDetail }) {
  // Pick the most specific array available. Reps > Duration > Weight (only
  // one of these is ever populated per detail row in practice).
  const reps = detail.actualRepsPerRound;
  const durs = detail.actualDurationSecondsPerRound;
  const weights = detail.actualWeightLbsPerRound;

  let label: string | null = null;
  let cells: string[] = [];
  if (reps && reps.length > 0) {
    label = "reps / round";
    cells = reps.map((n) => (n > 0 ? String(n) : "—"));
  } else if (durs && durs.length > 0) {
    label = "time / round";
    cells = durs.map((sec) => (sec > 0 ? formatTime(sec) : "—"));
  } else if (weights && weights.length > 0) {
    label = "weight / round";
    cells = weights.map((lb) => (lb > 0 ? `${lb} lb` : "—"));
  }

  if (!label || cells.length === 0) return null;

  return (
    <div className="space-y-0.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap gap-1 font-mono text-[11px]">
        {cells.map((c, i) => (
          <span
            key={i}
            className="rounded bg-muted/40 px-1.5 py-0.5 text-foreground/80"
          >
            R{i + 1} {c}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Compose a one-line summary of every non-Rx dimension the athlete logged:
 * modification, substitution, weight, reps, duration, height. Returns null
 * when there's nothing to summarize.
 */
function buildScaledSummary(detail: MovementScalingDetail): string | null {
  const parts: string[] = [];
  if (detail.modification?.trim()) parts.push(detail.modification.trim());
  if (detail.substitutionName?.trim()) {
    parts.push(`→ ${detail.substitutionName.trim()}`);
  }
  if (detail.actualWeightLb != null && detail.actualWeightLb > 0) {
    parts.push(`@ ${detail.actualWeightLb} lb`);
  }
  if (detail.actualReps?.trim()) parts.push(`${detail.actualReps.trim()} reps`);
  if (detail.actualDurationSeconds != null && detail.actualDurationSeconds > 0) {
    parts.push(formatTime(detail.actualDurationSeconds));
  }
  if (detail.actualHeightInches != null && detail.actualHeightInches > 0) {
    parts.push(`${detail.actualHeightInches}" height`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}
