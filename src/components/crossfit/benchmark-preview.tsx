"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Plus } from "lucide-react";
import { useState } from "react";
import type { BenchmarkWorkout } from "@/types/crossfit";
import { WORKOUT_TYPE_LABELS, WORKOUT_TYPE_COLORS } from "@/types/crossfit";

interface BenchmarkPreviewProps {
  benchmark: BenchmarkWorkout;
  onAdd: (benchmarkId: string, workoutDate: string) => void;
  onBack: () => void;
  isLoading?: boolean;
}

export function BenchmarkPreview({
  benchmark,
  onAdd,
  onBack,
  isLoading,
}: BenchmarkPreviewProps) {
  const [workoutDate, setWorkoutDate] = useState(
    new Date().toISOString().split("T")[0]
  );

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        &larr; Back to benchmarks
      </button>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">{benchmark.name}</h3>
          <Badge
            variant="outline"
            className={WORKOUT_TYPE_COLORS[benchmark.workoutType]}
          >
            {WORKOUT_TYPE_LABELS[benchmark.workoutType]}
          </Badge>
        </div>

        {benchmark.description && (
          <p className="text-sm text-muted-foreground">
            {benchmark.description}
          </p>
        )}

        {benchmark.repScheme && (
          <p className="text-sm font-medium">{benchmark.repScheme}</p>
        )}

        {benchmark.timeCapSeconds && (
          <p className="text-sm text-muted-foreground">
            Time cap: {Math.floor(benchmark.timeCapSeconds / 60)} min
          </p>
        )}

        {benchmark.amrapDurationSeconds && (
          <p className="text-sm text-muted-foreground">
            Duration: {Math.floor(benchmark.amrapDurationSeconds / 60)} min
          </p>
        )}
      </div>

      <Separator />

      {/* Movement list */}
      <div className="space-y-1.5">
        {benchmark.movements.map((m, i) => (
          <div key={m.id} className="flex items-baseline gap-2 text-sm">
            <span className="text-xs text-muted-foreground w-4 text-right">
              {i + 1}.
            </span>
            <span className="font-medium">{m.movementName}</span>
            {m.prescribedReps && (
              <span className="text-muted-foreground">{m.prescribedReps}</span>
            )}
            {(m.prescribedWeightMale || m.prescribedWeightFemale) && (
              <span className="text-xs text-muted-foreground">
                ({m.prescribedWeightMale}
                {m.prescribedWeightFemale
                  ? `/${m.prescribedWeightFemale}`
                  : ""}{" "}
                lb)
              </span>
            )}
            {m.rxStandard && (
              <span className="text-xs italic text-muted-foreground">
                {m.rxStandard}
              </span>
            )}
          </div>
        ))}
      </div>

      <Separator />

      {/* Date picker + Add button */}
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="bp-date">Workout Date</Label>
          <Input
            id="bp-date"
            type="date"
            value={workoutDate}
            onChange={(e) => setWorkoutDate(e.target.value)}
          />
        </div>

        <Button
          className="w-full"
          onClick={() => onAdd(benchmark.id, workoutDate)}
          disabled={isLoading}
        >
          <Plus className="size-4" />
          {isLoading ? "Adding..." : "Add Workout"}
        </Button>
      </div>
    </div>
  );
}
