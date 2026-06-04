"use client";

import { useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Clock,
  Dumbbell,
  Trophy,
  CheckCircle2,
  Flame,
  Trash2,
  Pencil,
  Shield,
  Users,
  Building2,
  Loader2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type {
  WorkoutDisplay,
  WorkoutMovementDisplay,
  WorkoutPartDisplay,
} from "@/types/crossfit";
import {
  WORKOUT_TYPE_LABELS,
  WORKOUT_TYPE_COLORS,
} from "@/types/crossfit";
import { formatTime } from "@/lib/workout-parser";
import { SetWeightBreakdown } from "@/components/crossfit/set-weight-breakdown";
import { AmrapScoreBreakdown } from "@/components/crossfit/amrap-score-breakdown";
import { formatSecondsAsClock } from "@/lib/crossfit/duration-parser";
import { formatMovementPrescription } from "@/lib/crossfit/prescription";
import { DeleteWorkoutDialog } from "@/components/crossfit/delete-workout-dialog";
import { WorkoutSectionBlock } from "@/components/crossfit/workout-section-block";
import { CalorieBadge } from "@/components/crossfit/calorie-badge";
import { useEffectiveEpocEnabled } from "@/hooks/useEpocPreference";
import { TemplateHistoryLink } from "@/components/crossfit/template-history-sheet";
import { SuggestionChip } from "@/components/crossfit/suggested-weight-chip";
import { WorkoutPrepCard } from "@/components/crossfit/workout-prep-card";
import {
  SuggestionContext,
  flattenSuggestions,
  useSuggestedWeights,
  useSuggestionForMovement,
} from "@/hooks/useSuggestedWeights";

// Programmed Rest is identified by name + duration metric, mirroring the
// builder's `isLegacyRestMovement` check. For a Rest the duration is the
// whole prescription, so the card promotes it to the bold "lead" slot
// rather than burying it in muted parens after the movement name.
function isRestMovement(mov: WorkoutMovementDisplay): boolean {
  return (
    mov.metricType === "duration" &&
    /^rest$/i.test((mov.movementName ?? "").trim())
  );
}

interface WorkoutCardProps {
  workout: WorkoutDisplay;
  onLogScore?: (workoutId: string, sectionId?: string) => void;
  onDelete?: (workoutId: string) => Promise<void> | void;
  onEdit?: (workoutId: string) => void;
  onViewLeaderboard?: (workoutId: string) => void;
  /** Opens the leaderboard for a free-form track-day section embedded in
   *  the workout (monthly challenge / custom track with no workoutPart).
   *  Threaded through to `WorkoutSectionBlock`. */
  onViewTrackDayLeaderboard?: (trackDayId: string, title: string) => void;
  // When set, renders a "Move to gym" button. Parent decides eligibility
  // (creator + admin of target gym + email allowlist). The handler receives
  // the workout id; the gym name is shown in the confirm dialog only.
  onMoveToGym?: (workoutId: string) => Promise<void> | void;
  moveToGymName?: string;
}

const DIVISION_COLORS = {
  rx: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  scaled: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  rx_plus: "bg-violet-500/15 text-violet-400 border-violet-500/25",
} as const;

const DIVISION_LABELS = {
  rx: "Rx",
  scaled: "Scaled",
  rx_plus: "Rx+",
} as const;

function ScoreRow({
  part,
  communityId,
}: {
  part: WorkoutPartDisplay;
  communityId: string | null | undefined;
}) {
  const s = part.score;
  const epocEnabled = useEffectiveEpocEnabled(communityId);
  if (!s) return null;
  const kcalForDisplay = epocEnabled
    ? s.estimatedKcalActiveWithEpoc
    : s.estimatedKcalActive;

  // When the part is athlete-weight-and-load-scored, prefer the heaviest
  // captured weight so the quick view matches the leaderboard rank key.
  // Derived from the per-round arrays (the canonical store) rather than
  // scores.weightLbs, which is reserved for for_load set-entries.
  const loadScoredHeaviest =
    part.scoreType === "load"
      ? (s.movementDetails ?? []).reduce((acc, d) => {
          const arr = d.actualWeightLbsPerRound ?? [];
          const movMax = arr.reduce(
            (a, n) => (Number.isFinite(n) && n > a ? n : a),
            0
          );
          return movMax > acc ? movMax : acc;
        }, 0)
      : 0;

  // Timed Rounds: display the aggregated time with the right suffix so the
  // user can tell "4:32" is the slowest / fastest / sum / avg of N rounds.
  const timedRoundsSuffix =
    part.workoutType === "timed_rounds"
      ? part.roundScoreAggregation === "fastest"
        ? " (fastest)"
        : part.roundScoreAggregation === "sum"
          ? " (total)"
          : part.roundScoreAggregation === "average"
            ? " (avg)"
            : " (slowest)"
      : "";

  let scoreDisplay = "";
  if (loadScoredHeaviest > 0) {
    scoreDisplay = `${loadScoredHeaviest} lb`;
  } else if (s.timeSeconds) {
    scoreDisplay = formatTime(s.timeSeconds) + timedRoundsSuffix;
    if (s.hitTimeCap) scoreDisplay += " (cap)";
  } else if (s.rounds !== undefined) {
    scoreDisplay = `${s.rounds} rds`;
    if (s.remainderReps) scoreDisplay += ` + ${s.remainderReps} reps`;
  } else if (s.weightLbs) {
    scoreDisplay = `${s.weightLbs} lb`;
  } else if (s.totalReps !== undefined) {
    scoreDisplay = `${s.totalReps} reps`;
  } else if (s.scoreText) {
    scoreDisplay = s.scoreText;
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10 px-3 py-2">
        <CheckCircle2 className="size-4 text-emerald-400" />
        <span className="font-mono text-sm font-bold text-foreground">
          {scoreDisplay}
        </span>
        <Badge
          variant="outline"
          className={`text-[10px] ${DIVISION_COLORS[s.division]}`}
        >
          {DIVISION_LABELS[s.division]}
        </Badge>
        {/* Vest badge — only meaningful when the workout requires a vest.
            Shows "Vest" / "No vest" so the leaderboard reflects whether
            this Rx Murph was wearing the vest or not. */}
        {s.woreVest === true && (
          <Badge
            variant="outline"
            className="text-[10px] bg-amber-500/15 text-amber-300 border-amber-500/30"
          >
            <Shield className="size-2.5 mr-0.5" />
            Vest
            {s.vestWeightLb != null ? ` ${s.vestWeightLb}` : ""}
          </Badge>
        )}
        {s.woreVest === false && (
          <Badge
            variant="outline"
            className="text-[10px] bg-zinc-500/15 text-zinc-300 border-zinc-500/30"
          >
            No vest
          </Badge>
        )}
        {s.rpe && (
          <span className="ml-auto text-[10px] text-muted-foreground font-mono">
            RPE {s.rpe}
          </span>
        )}
        {kcalForDisplay != null && (
          <CalorieBadge
            variant="score"
            midpoint={kcalForDisplay}
            confidence={s.estimatedKcalConfidence}
            className={s.rpe ? "" : "ml-auto"}
          />
        )}
      </div>

      {/* Round-by-round breakdown for AMRAP parts when we have parsed
          rep schemes / metric values to walk. Self-renders nothing
          when decomposition isn't possible. */}
      {part.workoutType === "amrap" && (
        <AmrapScoreBreakdown part={part} score={s} />
      )}

      {/* Timed Rounds: per-round splits with the aggregation-determining
          round highlighted. Lets the athlete see pacing at a glance. */}
      {part.workoutType === "timed_rounds" &&
        s.roundDurationsSeconds &&
        s.roundDurationsSeconds.length > 0 && (
          <TimedRoundsBreakdown
            durations={s.roundDurationsSeconds}
            aggregation={part.roundScoreAggregation ?? "slowest"}
            windowSeconds={part.roundWindowSeconds ?? null}
          />
        )}

      {/* Per-round time breakdown for movements that captured time per
          round (e.g. "Run 400m × 3 as fast as possible"). The summed total
          renders in the score chip above; the per-round splits go here so
          the athlete can see pacing. */}
      {s.movementDetails &&
        s.movementDetails
          .filter(
            (d) =>
              d.actualDurationSecondsPerRound &&
              d.actualDurationSecondsPerRound.some((sec) => sec > 0)
          )
          .map((d) => {
            const mov = part.movements.find(
              (m) => m.id === d.workoutMovementId
            );
            const rounds = d.actualDurationSecondsPerRound!;
            return (
              <div
                key={`time-per-round-${d.workoutMovementId}`}
                className="space-y-0.5 pl-2 text-xs"
              >
                {mov && (
                  <span className="text-[10px] text-muted-foreground">
                    {mov.movementName}
                  </span>
                )}
                <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
                  {rounds.map((sec, i) => (
                    <span
                      key={i}
                      className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300"
                    >
                      R{i + 1} {sec > 0 ? formatTime(sec) : "—"}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}

      {/* Per-set breakdown for for_load parts. A complex logs one weight per
          set (stored against the lead movement), so drop the per-movement
          label and the e1RM estimate — neither applies to a complex. */}
      {part.workoutType === "for_load" &&
        s.movementDetails &&
        s.movementDetails
          .filter(
            (d) => d.setEntries && d.setEntries.some((e) => e.weight > 0)
          )
          .map((d) => {
            const mov = part.movements.find(
              (m) => m.id === d.workoutMovementId
            );
            const isComplex = part.structure === "complex";
            return (
              <div
                key={d.workoutMovementId}
                className="space-y-0.5 pl-2 text-xs"
              >
                {mov && !isComplex && (
                  <span className="text-[10px] text-muted-foreground">
                    {mov.movementName}
                  </span>
                )}
                <SetWeightBreakdown
                  entries={d.setEntries!}
                  repsPerSet={
                    isComplex
                      ? undefined
                      : (() => {
                          const scheme =
                            mov?.prescribedReps || part.repScheme;
                          return scheme
                            ? parseRepsPerSet(scheme)
                            : undefined;
                        })()
                  }
                />
              </div>
            );
          })}
    </div>
  );
}

// Per-round splits for a timed_rounds score. Highlights the round that
// determined the aggregate (slowest → max; fastest → min). Sum and average
// have no single "winning" round so no highlight is rendered.
function TimedRoundsBreakdown({
  durations,
  aggregation,
  windowSeconds,
}: {
  durations: number[];
  aggregation: "slowest" | "fastest" | "sum" | "average";
  windowSeconds: number | null;
}) {
  const max = Math.max(...durations);
  const min = Math.min(...durations);
  const highlightIdx =
    aggregation === "slowest"
      ? durations.findIndex((d) => d === max)
      : aggregation === "fastest"
        ? durations.findIndex((d) => d === min)
        : -1;
  return (
    <div className="space-y-0.5 pl-2 text-xs">
      <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
        {durations.map((sec, i) => {
          const exceeded =
            windowSeconds != null && sec > windowSeconds;
          const isHighlight = i === highlightIdx;
          return (
            <span
              key={i}
              className={`rounded px-1.5 py-0.5 ${
                isHighlight
                  ? "bg-amber-500/20 text-amber-300 font-semibold"
                  : "bg-emerald-500/10 text-emerald-300"
              } ${exceeded ? "ring-1 ring-amber-500/40" : ""}`}
            >
              R{i + 1} {sec > 0 ? formatTime(sec) : "—"}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// for_load parts: weight is the score, not a prescription. Older saved
// workouts may still carry phantom common-Rx defaults from the builder
// (the input was hidden but the state field was populated). Nulling the
// weight fields here keeps those from rendering as bogus "(95/65 lb)".
function formatMovementMetric(
  mov: WorkoutMovementDisplay,
  partWorkoutType: WorkoutPartDisplay["workoutType"]
): string | null {
  const source =
    partWorkoutType === "for_load"
      ? {
          ...mov,
          prescribedWeightMale: null,
          prescribedWeightFemale: null,
          prescribedWeightMaleBwMultiplier: null,
          prescribedWeightFemaleBwMultiplier: null,
        }
      : mov;
  const full = formatMovementPrescription(source, null, null);
  if (!full) return null;
  // The reps segment is rendered separately on the card. Strip it so we
  // don't duplicate "21" once before the name and again in parens.
  const reps = (mov.prescribedReps ?? "").trim();
  let cleaned = full;
  if (reps && cleaned.startsWith(reps)) {
    cleaned = cleaned.slice(reps.length).replace(/^\s*·\s*/, "").trim();
  }
  return cleaned || null;
}

function parseRepsPerSet(repScheme: string): number | undefined {
  const parts = repScheme.split("-").filter((s) => /^\d+$/.test(s.trim()));
  if (parts.length === 0) return undefined;
  return parseInt(parts[parts.length - 1], 10);
}

function MovementRow({
  mov,
  partWorkoutType,
  partRepScheme,
  suggestionsHidden,
}: {
  mov: WorkoutMovementDisplay;
  partWorkoutType: WorkoutPartDisplay["workoutType"];
  /** Part-level shared rep scheme. For for_time / amrap, falls back here
   *  when the movement has no per-movement prescribedReps — keeps "applies
   *  to all movements" intent visible even if the per-movement prefill
   *  didn't run at authoring time. */
  partRepScheme?: string | null;
  /** When true, suppress the suggestion chip (used after a score is logged
   *  for the part — we don't second-guess the athlete on the same card). */
  suggestionsHidden?: boolean;
}) {
  const suggestion = useSuggestionForMovement(mov.id);
  const metricText = formatMovementMetric(mov, partWorkoutType);
  const prefix =
    mov.equipmentCount && mov.equipmentCount > 1
      ? `${mov.equipmentCount} × `
      : "";
  const effectiveReps =
    mov.prescribedReps?.trim() ||
    ((partWorkoutType === "for_time" || partWorkoutType === "amrap") &&
    partRepScheme?.trim()
      ? partRepScheme.trim()
      : "");

  // Rest rows promote the duration to the bold lead slot so the prescribed
  // length is the first thing the athlete reads — "0:30 Rest" instead of
  // "Rest (0:30)" tucked into muted parens.
  if (isRestMovement(mov)) {
    const durSec =
      mov.prescribedDurationSecondsMale ??
      mov.prescribedDurationSecondsFemale ??
      null;
    const durLabel = durSec != null ? formatSecondsAsClock(durSec) : null;
    return (
      <div className="flex items-center gap-2.5 text-sm">
        <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/10">
          <Dumbbell className="size-3 text-primary/70" />
        </div>
        <span className="flex-1">
          {durLabel && (
            <span className="font-mono font-bold text-foreground">
              {durLabel}{" "}
            </span>
          )}
          <span className="text-foreground/85">{mov.movementName}</span>
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5 text-sm">
      <div className="mt-0.5 flex h-5 w-5 items-center justify-center rounded bg-primary/10">
        <Dumbbell className="size-3 text-primary/70" />
      </div>
      <span className="flex-1">
        <span>
          {mov.isMaxReps ? (
            <span className="mr-1 inline-flex items-center rounded bg-amber-500/15 px-1 py-px text-[10px] font-bold text-amber-300">
              {mov.metricType === "calories"
                ? "MAX CAL"
                : mov.metricType === "distance"
                  ? "MAX DIST"
                  : mov.metricType === "duration"
                    ? "MAX TIME"
                    : "MAX REPS"}
            </span>
          ) : (
            effectiveReps && (
              <span className="font-mono font-bold text-foreground">
                {effectiveReps}{" "}
              </span>
            )
          )}
          <span className="text-foreground/85">{mov.movementName}</span>
          {metricText && (
            <span className="ml-1.5 text-xs text-muted-foreground font-mono">
              ({prefix}
              {metricText})
            </span>
          )}
          {!metricText && prefix && (
            <span className="ml-1.5 text-xs text-muted-foreground font-mono">
              ({mov.equipmentCount} DBs)
            </span>
          )}
        </span>
        {!suggestionsHidden && mov.isWeighted && suggestion && (
          <div className="mt-1">
            <SuggestionChip
              suggestion={suggestion}
              movementName={mov.movementName}
            />
          </div>
        )}
      </span>
    </div>
  );
}

// Renders a for_load complex as a single unbroken line —
// "5 Shoulder Press + 5 Push Press + 5 Push Jerk" — followed by the no-rest
// reminder. The "+" notation is the signal that the movements are performed
// as one continuous set rather than three separate lifts.
function ComplexMovementLine({
  movements,
}: {
  movements: WorkoutMovementDisplay[];
}) {
  if (movements.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-2.5 text-sm">
        <div className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/10">
          <Dumbbell className="size-3 text-primary/70" />
        </div>
        <span className="flex-1 leading-relaxed">
          {movements.map((mov, i) => (
            <span key={mov.id}>
              {i > 0 && <span className="mx-1 text-muted-foreground">+</span>}
              {mov.prescribedReps && (
                <span className="font-mono font-bold text-foreground">
                  {mov.prescribedReps}{" "}
                </span>
              )}
              <span className="text-foreground/85">{mov.movementName}</span>
            </span>
          ))}
        </span>
      </div>
      <p className="pl-[30px] text-[11px] text-muted-foreground">
        Unbroken — no rest between movements. Score is the heaviest set.
      </p>
    </div>
  );
}

export function PartSection({
  part,
  index,
  showLabel,
  communityId,
}: {
  part: WorkoutPartDisplay;
  index: number;
  showLabel: boolean;
  communityId: string | null | undefined;
}) {
  // Hide the suggestion chip after the athlete has logged a score for this
  // part (spec §"Per-movement suggestion on the WOD card" — we don't
  // second-guess the athlete on the same card).
  const suggestionsHidden = !!part.score;
  const typeColor = WORKOUT_TYPE_COLORS[part.workoutType];
  const typeLabel = WORKOUT_TYPE_LABELS[part.workoutType];
  const defaultLabel = `Part ${String.fromCharCode(65 + index)}`;

  // The "signature" — the defining structural value of the workout, rendered
  // big and clean below the type pill so athletes see it at a glance. Examples:
  // "75-50-25" (rep scheme), "5 rounds", "20:00" (AMRAP duration), the
  // interval sequence, etc. null = no signature line, just the pill.
  const signature: React.ReactNode = (() => {
    if (part.workoutType === "tabata" || part.structure === "tabata") {
      return (
        <>
          8 × :20<span className="opacity-60"> / </span>:10
        </>
      );
    }

    if (part.workoutType === "intervals") {
      if (part.intervalRounds && part.intervalRounds.length > 0) {
        return (
          <span className="flex flex-col gap-0.5 text-base sm:text-lg">
            <span className="text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
              work / rest
            </span>
            <span>
              {part.intervalRounds
                .map(
                  (r) =>
                    `${formatSecondsAsClock(r.workSeconds)} / ${formatSecondsAsClock(r.restSeconds)}`
                )
                .join(" → ")}
            </span>
          </span>
        );
      }
      const work =
        part.intervalWorkSeconds != null
          ? formatSecondsAsClock(part.intervalWorkSeconds)
          : null;
      const rest =
        part.intervalRestSeconds != null
          ? formatSecondsAsClock(part.intervalRestSeconds)
          : null;
      if (work || rest || part.rounds) {
        const roundsLabel = part.rounds
          ? `${part.rounds} ${part.rounds === 1 ? "round" : "rounds"}`
          : null;
        const workLabel = work ? `${work} work` : null;
        const restLabel = rest ? `${rest} rest` : null;
        const cadence = [workLabel, restLabel].filter(Boolean).join(" / ");
        const text =
          roundsLabel && cadence
            ? `${roundsLabel} · ${cadence}`
            : (roundsLabel ?? cadence);
        if (!text) return null;
        return <span className="text-base sm:text-lg">{text}</span>;
      }
      return null;
    }

    if (part.workoutType === "timed_rounds") {
      const rounds = part.rounds;
      const window = part.roundWindowSeconds;
      const aggregation = part.roundScoreAggregation ?? "slowest";
      const aggregationLabel =
        aggregation === "fastest"
          ? "Fastest Round"
          : aggregation === "sum"
            ? "Sum"
            : aggregation === "average"
              ? "Avg Round"
              : "Slowest Round";
      const headline =
        window != null && rounds
          ? `Every ${formatSecondsAsClock(window)} × ${rounds}`
          : rounds
            ? `${rounds} Timed Rounds`
            : "Timed Rounds";
      return (
        <span className="flex flex-col gap-0.5">
          <span>{headline}</span>
          <span className="text-sm font-normal text-muted-foreground">
            Score: {aggregationLabel}
          </span>
        </span>
      );
    }

    if (part.workoutType === "amrap" && part.amrapDurationSeconds) {
      const duration = formatTime(part.amrapDurationSeconds);
      // When the admin authored a shared rep scheme on the AMRAP (e.g. a
      // 1-2-3-... ladder), stack it under the duration so the ladder is
      // visible at a glance, not just inline next to each movement.
      if (part.repScheme?.trim()) {
        return (
          <span className="flex flex-col gap-0.5">
            <span>{duration}</span>
            <span className="text-sm font-normal text-muted-foreground">
              {part.repScheme}
            </span>
          </span>
        );
      }
      return duration;
    }

    if (part.repScheme) return part.repScheme;

    if (part.rounds) {
      const roundWord = part.workoutType === "for_load" ? "sets" : "rounds";
      return `${part.rounds} ${roundWord}`;
    }

    return null;
  })();

  // Secondary meta — kept small. Time cap is dropped for AMRAP since the
  // duration is already the signature.
  const secondaryBits: React.ReactNode[] = [];
  if (part.timeCapSeconds && part.workoutType !== "amrap") {
    secondaryBits.push(
      <span key="tc" className="flex items-center gap-1">
        <Clock className="size-3" />
        {formatTime(part.timeCapSeconds)} cap
      </span>
    );
  }
  if (part.sideCadenceIntervalSeconds) {
    secondaryBits.push(
      <span key="side-cadence" className="text-cyan-300/90 font-mono">
        EMOM {formatSecondsAsClock(part.sideCadenceIntervalSeconds)}
        {part.sideCadenceOpenEnded ? " (open-ended)" : ""}
      </span>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {showLabel && (
          <Badge variant="outline" className="text-[10px] bg-muted/40">
            {part.label || defaultLabel}
          </Badge>
        )}
        <Badge
          variant="outline"
          className={`text-xs font-bold ${typeColor}`}
        >
          {typeLabel}
        </Badge>
        {secondaryBits.length > 0 && (
          <span className="flex items-center gap-2.5 text-[11px] text-muted-foreground">
            {secondaryBits}
          </span>
        )}
      </div>

      {signature !== null && (
        <div className="font-mono font-bold text-base sm:text-lg tracking-tight leading-none text-foreground">
          {signature}
        </div>
      )}

      <div className="space-y-1.5 rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
        {part.structure === "complex" ? (
          // A complex is one unbroken set — render the movements joined,
          // ignoring any block grouping (a complex has none by definition).
          <ComplexMovementLine movements={part.movements} />
        ) : (
        (() => {
          const ungrouped = part.movements.filter((m) => !m.workoutBlockId);
          const movementsByBlock = new Map<string, WorkoutMovementDisplay[]>();
          for (const m of part.movements) {
            if (!m.workoutBlockId) continue;
            const list = movementsByBlock.get(m.workoutBlockId) ?? [];
            list.push(m);
            movementsByBlock.set(m.workoutBlockId, list);
          }
          const orderedBlocks = [...part.blocks].sort(
            (a, b) => a.orderIndex - b.orderIndex
          );

          return (
            <>
              {ungrouped.length > 0 && (
                <div className="space-y-1.5">
                  {ungrouped.map((mov) => (
                    <MovementRow
                      key={mov.id}
                      mov={mov}
                      partWorkoutType={part.workoutType}
                      partRepScheme={part.repScheme}
                      suggestionsHidden={suggestionsHidden}
                    />
                  ))}
                </div>
              )}
              {orderedBlocks.map((b, blockIdx) => {
                const blockMovements = movementsByBlock.get(b.id) ?? [];
                if (blockMovements.length === 0) return null;
                return (
                  <div
                    key={b.id}
                    className={
                      blockIdx === 0 && ungrouped.length === 0
                        ? "space-y-1"
                        : "space-y-1 pt-1"
                    }
                  >
                    <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {b.title}
                    </h4>
                    <div className="space-y-1.5">
                      {blockMovements.map((mov) => (
                        <MovementRow
                          key={mov.id}
                          mov={mov}
                          partWorkoutType={part.workoutType}
                          partRepScheme={part.repScheme}
                          suggestionsHidden={suggestionsHidden}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </>
          );
        })()
        )}
      </div>

      {part.score && <ScoreRow part={part} communityId={communityId} />}
    </div>
  );
}

export function WorkoutCard({
  workout,
  onLogScore,
  onDelete,
  onEdit,
  onViewLeaderboard,
  onViewTrackDayLeaderboard,
  onMoveToGym,
  moveToGymName,
}: WorkoutCardProps) {
  const parts = workout.parts ?? [];
  const hasAnyScore = parts.some((p) => p.score);
  const multiPart = parts.length > 1;
  const sections = workout.sections ?? [];
  const hasSections = sections.length > 0;

  // Pre-fetch the per-movement suggestion map for this template so each
  // MovementRow can render its chip without firing its own request. Skip
  // the request entirely when every part already has a logged score —
  // those rows hide the chip anyway.
  const needsSuggestions =
    !!workout.crossfitWorkoutId && parts.some((p) => !p.score);
  const { data: suggestionsData } = useSuggestedWeights(
    needsSuggestions ? workout.crossfitWorkoutId ?? null : null
  );
  const suggestionMap = flattenSuggestions(suggestionsData);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  const handleConfirmDelete = async () => {
    if (!onDelete) return;
    setIsDeleting(true);
    try {
      await onDelete(workout.id);
      setConfirmOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleConfirmMove = async () => {
    if (!onMoveToGym) return;
    setIsMoving(true);
    setMoveError(null);
    try {
      await onMoveToGym(workout.id);
      setMoveOpen(false);
    } catch (err) {
      setMoveError(
        err instanceof Error ? err.message : "Failed to move workout"
      );
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <SuggestionContext.Provider value={suggestionMap}>
    <Card className="gradient-border overflow-visible">
      <CardHeader>
        <div className="flex items-start gap-2">
          <div className="flex-1 space-y-1">
            <CardTitle className="text-base font-bold tracking-tight">
              {workout.title || "Workout"}
            </CardTitle>
            {workout.communityId && workout.communityName ? (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {workout.communityLogoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={workout.communityLogoUrl}
                    alt=""
                    className="h-3.5 w-3.5 rounded object-contain"
                  />
                ) : (
                  <Building2 className="h-3.5 w-3.5" />
                )}
                <span>{workout.communityName}</span>
              </div>
            ) : null}
          </div>
          {workout.crossfitWorkoutId && (
            <TemplateHistoryLink
              crossfitWorkoutId={workout.crossfitWorkoutId}
            />
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {workout.description && (
          <p className="text-xs text-muted-foreground/80 italic leading-relaxed">
            {workout.description}
          </p>
        )}

        {workout.requiresVest && (
          <div className="flex items-center gap-1.5 text-[11px] text-amber-300/90">
            <Shield className="size-3.5" />
            <span>
              {workout.vestWeightMaleLb || workout.vestWeightFemaleLb
                ? `${workout.vestWeightMaleLb ?? "?"}/${workout.vestWeightFemaleLb ?? "?"} lb vest required`
                : "Weighted vest required"}
            </span>
          </div>
        )}

        {workout.isPartner && (
          <div className="flex items-center gap-1.5 text-[11px] text-cyan-300/90">
            <Users className="size-3.5" />
            <span>
              Partner workout
              {workout.partnerCount && workout.partnerCount > 2
                ? ` (${workout.partnerCount}-person team)`
                : ""}
            </span>
          </div>
        )}

        {(workout.estimatedKcalLow != null && workout.estimatedKcalHigh != null) && (
          <div className="flex items-center gap-1.5">
            <CalorieBadge
              variant="detail"
              low={workout.estimatedKcalLow}
              high={workout.estimatedKcalHigh}
              confidence={workout.estimatedKcalConfidence}
            />
            <span className="text-[10px] text-muted-foreground/70">
              ref. 75 kg
            </span>
          </div>
        )}

        {hasSections ? (
          // Section layout: one card per typed section. Parts without a
          // section (legacy or freshly-added without grouping) trail at
          // the bottom under "Other".
          <>
            {sections
              .slice()
              .sort((a, b) => a.position - b.position)
              .map((section) => {
                const sectionParts = section.partIds
                  .map((pid) => parts.find((p) => p.id === pid))
                  .filter((p): p is (typeof parts)[number] => !!p);
                // Show Log Score for any section with Smart-Builder
                // parts. We don't gate on section.isScored because the
                // programming admin doesn't expose that toggle today —
                // every published section ships with is_scored=false,
                // which would hide the button everywhere. Track-injected
                // free-form sections render their own input via
                // TrackDayScoreInput inside the block.
                const sectionHasParts = sectionParts.length > 0;
                const sectionHasScore = sectionParts.some((p) => p.score);
                const showLogScore =
                  sectionHasParts && !section.sourceTrackId && !!onLogScore;
                const handleSectionLogScore = showLogScore
                  ? () => onLogScore?.(workout.id, section.id)
                  : undefined;
                if (sectionParts.length === 0) {
                  return (
                    <WorkoutSectionBlock
                      key={section.id}
                      section={section}
                      onViewTrackDayLeaderboard={onViewTrackDayLeaderboard}
                    >
                      <p className="text-xs text-muted-foreground/70 italic">
                        No movements yet.
                      </p>
                    </WorkoutSectionBlock>
                  );
                }
                return (
                  <WorkoutSectionBlock
                    key={section.id}
                    section={section}
                    onViewTrackDayLeaderboard={onViewTrackDayLeaderboard}
                    onLogScore={handleSectionLogScore}
                    sectionHasScore={sectionHasScore}
                    sectionIsMultiPart={sectionParts.length > 1}
                  >
                    {sectionParts.map((part, idx) => (
                      <div key={part.id} className="space-y-3">
                        {idx > 0 && <Separator />}
                        <PartSection
                          part={part}
                          index={idx}
                          showLabel={sectionParts.length > 1}
                          communityId={workout.communityId}
                        />
                      </div>
                    ))}
                  </WorkoutSectionBlock>
                );
              })}
            {(() => {
              const usedPartIds = new Set(
                sections.flatMap((s) => s.partIds)
              );
              const orphanParts = parts.filter((p) => !usedPartIds.has(p.id));
              if (orphanParts.length === 0) return null;
              return (
                <div className="space-y-4">
                  {orphanParts.map((part, idx) => (
                    <div key={part.id} className="space-y-4">
                      {idx > 0 && <Separator />}
                      <PartSection
                        part={part}
                        index={idx}
                        showLabel={orphanParts.length > 1}
                        communityId={workout.communityId}
                      />
                    </div>
                  ))}
                </div>
              );
            })()}
          </>
        ) : (
          parts.map((part, idx) => (
            <div key={part.id} className="space-y-4">
              {idx > 0 && <Separator />}
              <PartSection
                part={part}
                index={idx}
                showLabel={multiPart}
                communityId={workout.communityId}
              />
            </div>
          ))
        )}

        {/* "Last time you did this" prep card — stretch goals + anticipatory
            complaint banners drawn from the athlete's recent notes. Renders
            only when there are no scores logged yet on this WOD (the card
            self-hides when the payload is empty). */}
        {!hasAnyScore && (
          <WorkoutPrepCard workoutId={workout.id} enabled={!hasAnyScore} />
        )}
      </CardContent>

      <CardFooter className="gap-2">
        {!hasSections && (
          hasAnyScore ? (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 border-white/[0.08]"
              onClick={() => onLogScore?.(workout.id)}
            >
              <Trophy className="size-3.5" />
              {multiPart ? "Edit Scores" : "Edit Score"}
            </Button>
          ) : (
            <Button
              size="sm"
              className="flex-1"
              onClick={() => onLogScore?.(workout.id)}
            >
              <Flame className="size-3.5" />
              {multiPart ? "Log Scores" : "Log Score"}
            </Button>
          )
        )}
        {onViewLeaderboard && (
          <Button
            variant="outline"
            size="sm"
            className="border-white/[0.08]"
            onClick={() => onViewLeaderboard(workout.id)}
          >
            Leaderboard
          </Button>
        )}
        {onEdit && (
          <Button
            variant="outline"
            size="sm"
            className="border-white/[0.08] text-muted-foreground hover:text-foreground"
            onClick={() => onEdit(workout.id)}
            aria-label="Edit workout"
          >
            <Pencil className="size-3.5" />
          </Button>
        )}
        {onMoveToGym && (
          <Button
            variant="outline"
            size="sm"
            className="border-white/[0.08] text-muted-foreground hover:text-foreground"
            onClick={() => {
              setMoveError(null);
              setMoveOpen(true);
            }}
            aria-label="Move workout to gym"
            title={
              moveToGymName
                ? `Move to ${moveToGymName}`
                : "Move to gym"
            }
          >
            <Building2 className="size-3.5" />
          </Button>
        )}
        {onDelete && (
          <Button
            variant="outline"
            size="sm"
            className="border-white/[0.08] text-muted-foreground hover:text-destructive hover:border-destructive/30"
            onClick={() => setConfirmOpen(true)}
            aria-label="Delete workout"
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </CardFooter>

      {onDelete && (
        <DeleteWorkoutDialog
          workoutId={workout.id}
          workoutTitle={workout.title}
          open={confirmOpen}
          onOpenChange={(open) => {
            if (!isDeleting) setConfirmOpen(open);
          }}
          onConfirm={handleConfirmDelete}
          isDeleting={isDeleting}
        />
      )}

      {onMoveToGym && (
        <Dialog
          open={moveOpen}
          onOpenChange={(open) => {
            if (!isMoving) setMoveOpen(open);
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Move workout to gym?</DialogTitle>
              <DialogDescription>
                {workout.title ? `"${workout.title}"` : "This workout"} will
                move from your personal workouts to{" "}
                {moveToGymName ? (
                  <strong className="text-foreground">{moveToGymName}</strong>
                ) : (
                  "your gym"
                )}
                . All gym members will be able to see it, and your existing
                scores stay attached.
              </DialogDescription>
            </DialogHeader>

            {moveError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {moveError}
              </div>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setMoveOpen(false)}
                disabled={isMoving}
              >
                Cancel
              </Button>
              <Button onClick={handleConfirmMove} disabled={isMoving}>
                {isMoving ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Moving…
                  </>
                ) : (
                  "Move to gym"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
    </SuggestionContext.Provider>
  );
}
