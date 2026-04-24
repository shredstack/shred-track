"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Search,
  X,
  CalendarDays,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { WorkoutCard } from "@/components/crossfit/workout-card";
import { MovementSearch } from "@/components/crossfit/movement-search";
import { ScoreEntry } from "@/components/crossfit/score-entry";
import {
  useWorkoutSearch,
  useLogScore,
  useUpdateScore,
  useDeleteWorkout,
} from "@/hooks/useWorkouts";
import type { MovementOption, ScoreInput } from "@/types/crossfit";

// Parse YYYY-MM-DD as a local date (not UTC). Using `new Date("2025-11-18")`
// anchors to UTC midnight and displays as the prior day in negative timezones.
function parseDateStr(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatWorkoutDate(dateStr: string): { formatted: string; relative: string } {
  const date = parseDateStr(dateStr);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round(
    (startOfToday.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
  );

  const showYear = Math.abs(diffDays) > 180;
  const formatted = date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(showYear ? { year: "numeric" } : {}),
  });

  let relative: string;
  if (diffDays === 0) relative = "Today";
  else if (diffDays === 1) relative = "Yesterday";
  else if (diffDays > 0 && diffDays < 7) relative = `${diffDays}d ago`;
  else if (diffDays >= 7 && diffDays < 30) relative = `${Math.floor(diffDays / 7)}w ago`;
  else if (diffDays >= 30 && diffDays < 365) relative = `${Math.floor(diffDays / 30)}mo ago`;
  else if (diffDays >= 365) relative = `${Math.floor(diffDays / 365)}y ago`;
  else relative = "upcoming";

  return { formatted, relative };
}

export default function CrossfitSearchPage() {
  const [q, setQ] = useState("");
  const [selectedMovement, setSelectedMovement] = useState<MovementOption | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [scoringWorkoutId, setScoringWorkoutId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const filters = useMemo(
    () => ({
      q: q.trim() || undefined,
      movementId: selectedMovement?.id,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    }),
    [q, selectedMovement, startDate, endDate]
  );

  const { data: results = [], isLoading, isError } = useWorkoutSearch(filters);
  const logScore = useLogScore();
  const updateScore = useUpdateScore();
  const deleteWorkout = useDeleteWorkout();

  const scoringWorkout = useMemo(
    () => results.find((w) => w.id === scoringWorkoutId) ?? null,
    [results, scoringWorkoutId]
  );

  const hasAnyFilter = !!(q.trim() || selectedMovement || startDate || endDate);

  const clearAll = () => {
    setQ("");
    setSelectedMovement(null);
    setStartDate("");
    setEndDate("");
  };

  const handlePartScoreSubmit = async (partId: string, score: ScoreInput) => {
    if (!scoringWorkout) return;
    const part = scoringWorkout.parts.find((p) => p.id === partId);
    if (!part) return;
    try {
      if (part.score?.id) {
        await updateScore.mutateAsync({ scoreId: part.score.id, score });
      } else {
        await logScore.mutateAsync(score);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save score");
    }
  };

  const handleDelete = async (workoutId: string) => {
    try {
      await deleteWorkout.mutateAsync(workoutId);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Link href="/crossfit" aria-label="Back to workouts">
          <Button variant="ghost" size="icon-xs">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-base font-bold">Search Workouts</h1>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title, description..."
            className="pl-8"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Movement
          </label>
          {selectedMovement ? (
            <div className="flex items-center gap-1.5">
              <Badge variant="secondary" className="gap-1.5 px-2.5 py-1 text-sm">
                {selectedMovement.canonicalName}
                <button
                  type="button"
                  onClick={() => setSelectedMovement(null)}
                  className="-mr-1 rounded-full p-0.5 hover:bg-white/10"
                  aria-label="Clear movement filter"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            </div>
          ) : (
            <MovementSearch
              placeholder="Filter by movement..."
              onSelect={(m) => setSelectedMovement(m)}
            />
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              From
            </label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              max={endDate || undefined}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              To
            </label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate || undefined}
            />
          </div>
        </div>

        {hasAnyFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAll}
            className="self-start text-muted-foreground"
          >
            Clear filters
          </Button>
        )}
      </div>

      {saveError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {saveError}
        </div>
      )}

      {!hasAnyFilter ? (
        <Card className="border-dashed border-white/[0.06]">
          <CardContent className="flex flex-col items-center gap-3 py-10">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <Search className="h-6 w-6 text-primary/60" />
            </div>
            <div className="text-center">
              <p className="font-semibold">Search your workouts</p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                Filter by movement, date, or title to find past workouts and log
                scores.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <Card className="border-destructive/30">
          <CardContent className="py-6 text-center">
            <p className="text-sm text-destructive">
              Search failed. Try again.
            </p>
          </CardContent>
        </Card>
      ) : results.length === 0 ? (
        <Card className="border-dashed border-white/[0.06]">
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No workouts match your filters.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-muted-foreground">
            {results.length} result{results.length === 1 ? "" : "s"}
          </p>
          {results.map((workout) => {
            const { formatted, relative } = formatWorkoutDate(workout.workoutDate);
            return (
              <div key={workout.id} className="space-y-1.5">
                <div className="flex items-center gap-1.5 px-1 text-xs">
                  <CalendarDays className="size-3 text-muted-foreground" />
                  <span className="font-semibold text-foreground">{formatted}</span>
                  <span className="text-muted-foreground">· {relative}</span>
                </div>
                <WorkoutCard
                  workout={workout}
                  onLogScore={() => setScoringWorkoutId(workout.id)}
                  onDelete={handleDelete}
                />
              </div>
            );
          })}
        </div>
      )}

      {scoringWorkout && (
        <ScoreEntry
          open
          onOpenChange={(open) => {
            if (!open) setScoringWorkoutId(null);
          }}
          workoutId={scoringWorkout.id}
          workoutTitle={scoringWorkout.title}
          parts={scoringWorkout.parts}
          onSubmit={handlePartScoreSubmit}
        />
      )}
    </div>
  );
}
