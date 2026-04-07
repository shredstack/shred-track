"use client";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  CardAction,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Clock,
  Dumbbell,
  Trophy,
  CheckCircle2,
  Flame,
} from "lucide-react";
import type { WorkoutDisplay } from "@/types/crossfit";
import {
  WORKOUT_TYPE_LABELS,
  WORKOUT_TYPE_COLORS,
} from "@/types/crossfit";
import { formatTime } from "@/lib/workout-parser";

interface WorkoutCardProps {
  workout: WorkoutDisplay;
  onLogScore?: (workoutId: string) => void;
  onViewLeaderboard?: (workoutId: string) => void;
}

export function WorkoutCard({
  workout,
  onLogScore,
  onViewLeaderboard,
}: WorkoutCardProps) {
  const typeLabel = WORKOUT_TYPE_LABELS[workout.workoutType];
  const typeColor = WORKOUT_TYPE_COLORS[workout.workoutType];
  const hasScore = !!workout.score;

  const renderMetadata = () => {
    const items: React.ReactNode[] = [];

    if (workout.timeCapSeconds) {
      items.push(
        <span key="tc" className="flex items-center gap-1 text-muted-foreground">
          <Clock className="size-3" />
          {formatTime(workout.timeCapSeconds)} cap
        </span>
      );
    }
    if (workout.amrapDurationSeconds) {
      items.push(
        <span key="amrap" className="flex items-center gap-1 text-muted-foreground">
          <Clock className="size-3" />
          {formatTime(workout.amrapDurationSeconds)}
        </span>
      );
    }
    if (workout.repScheme) {
      items.push(
        <span key="reps" className="text-muted-foreground font-mono">
          {workout.repScheme}
        </span>
      );
    }

    if (items.length === 0) return null;

    return (
      <div className="flex flex-wrap items-center gap-2.5 text-[11px]">
        {items}
      </div>
    );
  };

  const renderScore = () => {
    if (!workout.score) return null;
    const s = workout.score;

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

    const divisionColors = {
      rx: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
      scaled: "bg-amber-500/15 text-amber-400 border-amber-500/25",
      rx_plus: "bg-violet-500/15 text-violet-400 border-violet-500/25",
    };

    const divisionLabels = {
      rx: "Rx",
      scaled: "Scaled",
      rx_plus: "Rx+",
    };

    return (
      <div className="flex items-center gap-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10 px-3 py-2">
        <CheckCircle2 className="size-4 text-emerald-400" />
        <span className="font-mono text-sm font-bold text-foreground">
          {scoreDisplay}
        </span>
        <Badge
          variant="outline"
          className={`text-[10px] ${divisionColors[s.division]}`}
        >
          {divisionLabels[s.division]}
        </Badge>
        {s.rpe && (
          <span className="ml-auto text-[10px] text-muted-foreground font-mono">
            RPE {s.rpe}
          </span>
        )}
      </div>
    );
  };

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
        <CardAction>
          <Badge
            variant="outline"
            className={`text-[10px] font-bold ${typeColor}`}
          >
            {typeLabel}
          </Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-3">
        {renderMetadata()}

        {workout.description && (
          <p className="text-xs text-muted-foreground/80 italic leading-relaxed">
            {workout.description}
          </p>
        )}

        <div className="space-y-1.5 rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
          {workout.movements.map((mov) => (
            <div
              key={mov.id}
              className="flex items-center gap-2.5 text-sm"
            >
              <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/10">
                <Dumbbell className="size-3 text-primary/70" />
              </div>
              <span className="flex-1">
                {mov.prescribedReps && (
                  <span className="font-mono font-bold text-foreground">
                    {mov.prescribedReps}{" "}
                  </span>
                )}
                <span className="text-foreground/85">
                  {mov.movementName}
                </span>
                {(mov.prescribedWeightMale || mov.prescribedWeightFemale) && (
                  <span className="ml-1.5 text-xs text-muted-foreground font-mono">
                    ({mov.prescribedWeightMale || "?"}
                    {mov.prescribedWeightFemale && `/${mov.prescribedWeightFemale}`}
                    {" lb"})
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>

        {hasScore && renderScore()}
      </CardContent>

      <CardFooter className="gap-2">
        {hasScore ? (
          <Button
            variant="outline"
            size="sm"
            className="flex-1 border-white/[0.08]"
            onClick={() => onLogScore?.(workout.id)}
          >
            <Trophy className="size-3.5" />
            Edit Score
          </Button>
        ) : (
          <Button
            size="sm"
            className="flex-1"
            onClick={() => onLogScore?.(workout.id)}
          >
            <Flame className="size-3.5" />
            Log Score
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
      </CardFooter>
    </Card>
  );
}
