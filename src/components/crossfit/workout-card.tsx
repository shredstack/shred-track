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
import { Separator } from "@/components/ui/separator";
import {
  Clock,
  Dumbbell,
  Trophy,
  CalendarDays,
  CheckCircle2,
} from "lucide-react";
import type { WorkoutDisplay } from "@/types/crossfit";
import {
  WORKOUT_TYPE_LABELS,
  WORKOUT_TYPE_COLORS,
} from "@/types/crossfit";
import { formatTime } from "@/lib/workout-parser";

// ============================================
// Props
// ============================================

interface WorkoutCardProps {
  workout: WorkoutDisplay;
  onLogScore?: (workoutId: string) => void;
  onViewLeaderboard?: (workoutId: string) => void;
}

// ============================================
// Component
// ============================================

export function WorkoutCard({
  workout,
  onLogScore,
  onViewLeaderboard,
}: WorkoutCardProps) {
  const typeLabel = WORKOUT_TYPE_LABELS[workout.workoutType];
  const typeColor = WORKOUT_TYPE_COLORS[workout.workoutType];
  const hasScore = !!workout.score;

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + "T00:00:00");
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

  const renderMetadata = () => {
    const items: React.ReactNode[] = [];

    if (workout.timeCapSeconds) {
      items.push(
        <span key="tc" className="flex items-center gap-1 text-muted-foreground">
          <Clock className="size-3.5" />
          {formatTime(workout.timeCapSeconds)} cap
        </span>
      );
    }
    if (workout.amrapDurationSeconds) {
      items.push(
        <span key="amrap" className="flex items-center gap-1 text-muted-foreground">
          <Clock className="size-3.5" />
          {formatTime(workout.amrapDurationSeconds)}
        </span>
      );
    }
    if (workout.repScheme) {
      items.push(
        <span key="reps" className="text-muted-foreground">
          {workout.repScheme}
        </span>
      );
    }

    if (items.length === 0) return null;

    return (
      <div className="flex flex-wrap items-center gap-3 text-xs">
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
      rx: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
      scaled: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
      rx_plus: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    };

    const divisionLabels = {
      rx: "Rx",
      scaled: "Scaled",
      rx_plus: "Rx+",
    };

    return (
      <div className="flex items-center gap-2">
        <CheckCircle2 className="size-4 text-emerald-400" />
        <span className="font-mono font-semibold text-foreground">
          {scoreDisplay}
        </span>
        <Badge
          variant="outline"
          className={`text-[10px] ${divisionColors[s.division]}`}
        >
          {divisionLabels[s.division]}
        </Badge>
        {s.rpe && (
          <span className="text-[10px] text-muted-foreground">
            RPE {s.rpe}
          </span>
        )}
      </div>
    );
  };

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
      <CardHeader>
        <div className="flex items-start gap-2">
          <div className="flex-1 space-y-1">
            <CardTitle className="text-base font-semibold">
              {workout.title || "Workout"}
            </CardTitle>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CalendarDays className="size-3.5" />
              {formatDate(workout.workoutDate)}
            </div>
          </div>
        </div>
        <CardAction>
          <Badge
            variant="outline"
            className={`text-[10px] font-semibold ${typeColor}`}
          >
            {typeLabel}
          </Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-3">
        {renderMetadata()}

        {workout.description && (
          <p className="text-xs text-muted-foreground italic">
            {workout.description}
          </p>
        )}

        <div className="space-y-1.5">
          {workout.movements.map((mov) => (
            <div
              key={mov.id}
              className="flex items-center gap-2 text-sm"
            >
              <Dumbbell className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1">
                {mov.prescribedReps && (
                  <span className="font-mono font-medium text-foreground">
                    {mov.prescribedReps}{" "}
                  </span>
                )}
                <span className="text-foreground/90">
                  {mov.movementName}
                </span>
                {(mov.prescribedWeightMale || mov.prescribedWeightFemale) && (
                  <span className="ml-1 text-muted-foreground">
                    ({mov.prescribedWeightMale || "?"}
                    {mov.prescribedWeightFemale && `/${mov.prescribedWeightFemale}`}
                    {" lb"})
                  </span>
                )}
              </span>
              {mov.rxStandard && (
                <span className="text-[10px] text-muted-foreground">
                  {mov.rxStandard}
                </span>
              )}
            </div>
          ))}
        </div>

        {hasScore && (
          <>
            <Separator className="opacity-50" />
            {renderScore()}
          </>
        )}
      </CardContent>

      <CardFooter className="gap-2">
        {hasScore ? (
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => onLogScore?.(workout.id)}
          >
            <Trophy className="size-3.5" />
            Update Score
          </Button>
        ) : (
          <Button
            size="sm"
            className="flex-1"
            onClick={() => onLogScore?.(workout.id)}
          >
            <Trophy className="size-3.5" />
            Log Score
          </Button>
        )}
        {onViewLeaderboard && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onViewLeaderboard(workout.id)}
          >
            Leaderboard
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
