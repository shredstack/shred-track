"use client";

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
} from "lucide-react";
import type { WorkoutDisplay, WorkoutPartDisplay } from "@/types/crossfit";
import {
  WORKOUT_TYPE_LABELS,
  WORKOUT_TYPE_COLORS,
} from "@/types/crossfit";
import { formatTime } from "@/lib/workout-parser";
import { SetWeightBreakdown } from "@/components/crossfit/set-weight-breakdown";

interface WorkoutCardProps {
  workout: WorkoutDisplay;
  onLogScore?: (workoutId: string) => void;
  onDelete?: (workoutId: string) => void;
  onViewLeaderboard?: (workoutId: string) => void;
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

function ScoreRow({ part }: { part: WorkoutPartDisplay }) {
  const s = part.score;
  if (!s) return null;

  let scoreDisplay = "";
  if (s.timeSeconds) {
    scoreDisplay = formatTime(s.timeSeconds);
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
        {s.rpe && (
          <span className="ml-auto text-[10px] text-muted-foreground font-mono">
            RPE {s.rpe}
          </span>
        )}
      </div>

      {/* Per-set breakdown for for_load parts */}
      {part.workoutType === "for_load" &&
        s.movementDetails &&
        s.movementDetails
          .filter(
            (d) => d.setWeights && d.setWeights.some((w) => w > 0)
          )
          .map((d) => {
            const mov = part.movements.find(
              (m) => m.id === d.workoutMovementId
            );
            return (
              <div
                key={d.workoutMovementId}
                className="space-y-0.5 pl-2 text-xs"
              >
                {mov && (
                  <span className="text-[10px] text-muted-foreground">
                    {mov.movementName}
                  </span>
                )}
                <SetWeightBreakdown
                  setWeights={d.setWeights!}
                  repsPerSet={
                    part.repScheme
                      ? parseRepsPerSet(part.repScheme)
                      : undefined
                  }
                />
              </div>
            );
          })}
    </div>
  );
}

function parseRepsPerSet(repScheme: string): number | undefined {
  const parts = repScheme.split("-").filter((s) => /^\d+$/.test(s.trim()));
  if (parts.length === 0) return undefined;
  return parseInt(parts[parts.length - 1], 10);
}

function PartSection({
  part,
  index,
  showLabel,
}: {
  part: WorkoutPartDisplay;
  index: number;
  showLabel: boolean;
}) {
  const typeColor = WORKOUT_TYPE_COLORS[part.workoutType];
  const typeLabel = WORKOUT_TYPE_LABELS[part.workoutType];
  const defaultLabel = `Part ${String.fromCharCode(65 + index)}`;

  const metaBits: React.ReactNode[] = [];
  if (part.timeCapSeconds) {
    metaBits.push(
      <span key="tc" className="flex items-center gap-1 text-muted-foreground">
        <Clock className="size-3" />
        {formatTime(part.timeCapSeconds)} cap
      </span>
    );
  }
  if (part.amrapDurationSeconds) {
    metaBits.push(
      <span
        key="amrap"
        className="flex items-center gap-1 text-muted-foreground"
      >
        <Clock className="size-3" />
        {formatTime(part.amrapDurationSeconds)}
      </span>
    );
  }
  if (part.repScheme) {
    metaBits.push(
      <span key="reps" className="text-muted-foreground font-mono">
        {part.repScheme}
      </span>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        {showLabel && (
          <Badge variant="outline" className="text-[10px] bg-muted/40">
            {part.label || defaultLabel}
          </Badge>
        )}
        <Badge variant="outline" className={`text-[10px] font-bold ${typeColor}`}>
          {typeLabel}
        </Badge>
        {metaBits.length > 0 && (
          <span className="flex items-center gap-2.5 text-[11px]">
            {metaBits}
          </span>
        )}
      </div>

      <div className="space-y-1.5 rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
        {part.movements.map((mov) => {
          const hasWeight = mov.prescribedWeightMale || mov.prescribedWeightFemale;
          const weightText = hasWeight
            ? `${mov.prescribedWeightMale || "?"}${
                mov.prescribedWeightFemale ? `/${mov.prescribedWeightFemale}` : ""
              } lb`
            : null;
          const prefix =
            mov.equipmentCount && mov.equipmentCount > 1
              ? `${mov.equipmentCount} × `
              : "";
          return (
            <div key={mov.id} className="flex items-center gap-2.5 text-sm">
              <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/10">
                <Dumbbell className="size-3 text-primary/70" />
              </div>
              <span className="flex-1">
                {mov.prescribedReps && (
                  <span className="font-mono font-bold text-foreground">
                    {mov.prescribedReps}{" "}
                  </span>
                )}
                <span className="text-foreground/85">{mov.movementName}</span>
                {weightText && (
                  <span className="ml-1.5 text-xs text-muted-foreground font-mono">
                    ({prefix}
                    {weightText})
                  </span>
                )}
                {!hasWeight && prefix && (
                  <span className="ml-1.5 text-xs text-muted-foreground font-mono">
                    ({mov.equipmentCount} DBs)
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {part.score && <ScoreRow part={part} />}
    </div>
  );
}

export function WorkoutCard({
  workout,
  onLogScore,
  onDelete,
  onViewLeaderboard,
}: WorkoutCardProps) {
  const parts = workout.parts ?? [];
  const hasAnyScore = parts.some((p) => p.score);
  const multiPart = parts.length > 1;

  return (
    <Card className="gradient-border overflow-visible">
      <CardHeader>
        <div className="flex items-start gap-2">
          <div className="flex-1 space-y-0.5">
            <CardTitle className="text-base font-bold tracking-tight">
              {workout.title || "Workout"}
            </CardTitle>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {workout.description && (
          <p className="text-xs text-muted-foreground/80 italic leading-relaxed">
            {workout.description}
          </p>
        )}

        {parts.map((part, idx) => (
          <div key={part.id} className="space-y-4">
            {idx > 0 && <Separator />}
            <PartSection part={part} index={idx} showLabel={multiPart} />
          </div>
        ))}
      </CardContent>

      <CardFooter className="gap-2">
        {hasAnyScore ? (
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
        {onDelete && (
          <Button
            variant="outline"
            size="sm"
            className="border-white/[0.08] text-muted-foreground hover:text-destructive hover:border-destructive/30"
            onClick={() => {
              if (window.confirm("Delete this workout?")) {
                onDelete(workout.id);
              }
            }}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
