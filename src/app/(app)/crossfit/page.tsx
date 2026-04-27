"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Plus, ClipboardPaste, Wrench, Zap, Trophy, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WorkoutCard } from "@/components/crossfit/workout-card";
import { SmartBuilder } from "@/components/crossfit/smart-builder";
import { WorkoutParser } from "@/components/crossfit/workout-parser";
import { BenchmarkPicker } from "@/components/crossfit/benchmark-picker";
import { ScoreEntry } from "@/components/crossfit/score-entry";
import { DateNavigator } from "@/components/crossfit/date-navigator";
import {
  useWorkoutsByDate,
  useCreateWorkout,
  useDeleteWorkout,
  useLogScore,
  useUpdateScore,
  type CreatePartInput,
} from "@/hooks/useWorkouts";
import { useMovements, useCreateMovement } from "@/hooks/useMovements";
import type {
  WorkoutBuilderForm,
  WorkoutBuilderPart,
  ParsedWorkout,
  ParsedMovement,
  ScoreInput,
  MovementOption,
} from "@/types/crossfit";

// Local (not UTC) YYYY-MM-DD. `.toISOString()` yields a UTC date, which
// in positive timezones can roll a selected "Nov 18 local" back to Nov 17.
function toDateString(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ============================================
// Builder form → API payload
// ============================================

function builderPartToPayload(part: WorkoutBuilderPart): CreatePartInput | null {
  const movements = part.movements.filter((m) => m.movementId);
  if (movements.length === 0) return null;
  return {
    label: part.label || undefined,
    workoutType: part.workoutType,
    timeCapSeconds: part.timeCapMinutes
      ? parseInt(part.timeCapMinutes) * 60
      : undefined,
    amrapDurationSeconds: part.amrapDurationMinutes
      ? parseInt(part.amrapDurationMinutes) * 60
      : undefined,
    emomIntervalSeconds: part.emomIntervalSeconds
      ? parseInt(part.emomIntervalSeconds)
      : undefined,
    repScheme: part.repScheme || undefined,
    rounds:
      part.workoutType === "for_time" && part.rounds
        ? parseInt(part.rounds)
        : undefined,
    movements: movements.map((m, i) => ({
      movementId: m.movementId!,
      orderIndex: i,
      prescribedReps: m.prescribedReps || undefined,
      prescribedWeightMale: m.prescribedWeightMale
        ? parseFloat(m.prescribedWeightMale)
        : undefined,
      prescribedWeightFemale: m.prescribedWeightFemale
        ? parseFloat(m.prescribedWeightFemale)
        : undefined,
      equipmentCount: m.equipmentCount,
      rxStandard: m.rxStandard || undefined,
    })),
  };
}

// ============================================
// Page
// ============================================

export default function CrossfitPage() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showAddWorkout, setShowAddWorkout] = useState(false);
  const [scoringWorkoutId, setScoringWorkoutId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dateStr = toDateString(selectedDate);

  const { data: workouts = [], isLoading } = useWorkoutsByDate(dateStr);
  const { data: movementLibrary = [] } = useMovements();
  const createWorkout = useCreateWorkout();
  const deleteWorkout = useDeleteWorkout();
  const logScore = useLogScore();
  const updateScore = useUpdateScore();
  const createMovement = useCreateMovement();

  const scoringWorkout = useMemo(
    () => workouts.find((w) => w.id === scoringWorkoutId) ?? null,
    [workouts, scoringWorkoutId]
  );

  // ============================================
  // Save — Smart Builder
  // ============================================

  const handleSaveFromBuilder = async (form: WorkoutBuilderForm) => {
    setSaveError(null);
    const parts = form.parts
      .map(builderPartToPayload)
      .filter((p): p is CreatePartInput => p !== null);
    if (parts.length === 0) {
      setSaveError("Add at least one part with movements.");
      return;
    }

    try {
      await createWorkout.mutateAsync({
        title: form.title || undefined,
        description: form.description || undefined,
        workoutDate: form.workoutDate || dateStr,
        benchmarkWorkoutId: form.benchmarkWorkoutId ?? undefined,
        parts,
      });
      setShowAddWorkout(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save workout");
    }
  };

  // ============================================
  // Save — Paste/Parser flow
  // ============================================
  //
  // The parser returns movements with canonical names (not IDs). Resolve each
  // name against the live movement library; auto-create missing ones as
  // user-scoped custom movements so the save always succeeds.

  const resolveMovementId = async (
    parsed: ParsedMovement
  ): Promise<MovementOption | null> => {
    const targetName = (parsed.matchedCanonicalName || parsed.name).trim();
    if (!targetName) return null;
    const match = movementLibrary.find(
      (m) => m.canonicalName.toLowerCase() === targetName.toLowerCase()
    );
    if (match) return match;
    // Not in the library — create a user-owned custom movement.
    try {
      return await createMovement.mutateAsync({ canonicalName: targetName });
    } catch {
      return null;
    }
  };

  const handleSaveFromParser = async (parsed: ParsedWorkout) => {
    setSaveError(null);

    const resolved = await Promise.all(
      parsed.movements.map(async (m) => ({
        parsed: m,
        movement: await resolveMovementId(m),
      }))
    );

    const usable = resolved.filter((r) => r.movement !== null);
    if (usable.length === 0) {
      setSaveError("Couldn't resolve any movements. Try the Smart Builder.");
      return;
    }

    try {
      await createWorkout.mutateAsync({
        title: parsed.title,
        description: parsed.description,
        workoutDate: dateStr,
        parts: [
          {
            workoutType: parsed.workoutType,
            timeCapSeconds: parsed.timeCapSeconds,
            amrapDurationSeconds: parsed.amrapDurationSeconds,
            repScheme: parsed.repScheme,
            movements: usable.map((r, i) => ({
              movementId: r.movement!.id,
              orderIndex: i,
              prescribedReps: r.parsed.reps,
              prescribedWeightMale: r.parsed.weightMale,
              prescribedWeightFemale: r.parsed.weightFemale,
            })),
          },
        ],
      });
      setShowAddWorkout(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save workout");
    }
  };

  // ============================================
  // Delete
  // ============================================

  const handleDeleteWorkout = async (workoutId: string) => {
    try {
      await deleteWorkout.mutateAsync(workoutId);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  // ============================================
  // Score submit
  // ============================================

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

  // ============================================
  // Render
  // ============================================

  return (
    <div className="flex flex-col gap-5">
      <DateNavigator selectedDate={selectedDate} onDateChange={setSelectedDate} />

      <div className="flex items-center justify-end gap-2">
        <Link href="/crossfit/search">
          <Button variant="outline" size="sm" className="gap-1.5 border-white/[0.08]">
            <Search className="h-4 w-4" />
            Search
          </Button>
        </Link>
        <Button
          size="sm"
          onClick={() => {
            setSaveError(null);
            setShowAddWorkout(true);
          }}
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Add Workout
        </Button>
      </div>

      {saveError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {saveError}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {workouts.map((workout) => (
            <WorkoutCard
              key={workout.id}
              workout={workout}
              onLogScore={() => setScoringWorkoutId(workout.id)}
              onDelete={handleDeleteWorkout}
            />
          ))}

          {workouts.length === 0 && (
            <Card className="border-dashed border-white/[0.06]">
              <CardContent className="flex flex-col items-center gap-4 py-10">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                  <Zap className="h-6 w-6 text-primary/60" />
                </div>
                <div className="text-center">
                  <p className="font-semibold">No workouts for this date</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Add a workout or paste one from your gym
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="mt-1 border-white/[0.08]"
                  onClick={() => setShowAddWorkout(true)}
                >
                  <Plus className="h-4 w-4" />
                  Add Workout
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={showAddWorkout} onOpenChange={setShowAddWorkout}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Workout</DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="build">
            <TabsList className="w-full">
              <TabsTrigger value="paste" className="flex-1 gap-1.5">
                <ClipboardPaste className="h-3.5 w-3.5" />
                Paste
              </TabsTrigger>
              <TabsTrigger value="build" className="flex-1 gap-1.5">
                <Wrench className="h-3.5 w-3.5" />
                Smart Builder
              </TabsTrigger>
              <TabsTrigger value="benchmark" className="flex-1 gap-1.5">
                <Trophy className="h-3.5 w-3.5" />
                Benchmark
              </TabsTrigger>
            </TabsList>
            <TabsContent value="paste" className="mt-4">
              <WorkoutParser
                onSave={handleSaveFromParser}
                onCancel={() => setShowAddWorkout(false)}
              />
            </TabsContent>
            <TabsContent value="build" className="mt-4">
              <SmartBuilder
                onSave={handleSaveFromBuilder}
                onCancel={() => setShowAddWorkout(false)}
              />
            </TabsContent>
            <TabsContent value="benchmark" className="mt-4">
              <BenchmarkPicker
                onWorkoutCreated={() => setShowAddWorkout(false)}
                workoutDate={dateStr}
              />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

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
