"use client";

import { useState } from "react";
import { Calendar, Plus, ClipboardPaste, Wrench, Zap, Trophy } from "lucide-react";
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
import type {
  WorkoutDisplay,
  WorkoutMovementDisplay,
  WorkoutBuilderForm,
  ParsedWorkout,
  WorkoutType,
  ScoreInput,
  ScoreDisplay,
} from "@/types/crossfit";

// Demo workout for initial experience
const demoWorkout: WorkoutDisplay = {
  id: "demo-1",
  title: "Fran",
  workoutType: "for_time",
  workoutDate: new Date().toISOString().split("T")[0],
  timeCapSeconds: 600,
  createdBy: "demo-user",
  movements: [
    {
      id: "m1",
      movementId: "thruster",
      movementName: "Thruster",
      category: "barbell",
      isWeighted: true,
      prescribedReps: "21-15-9",
      prescribedWeightMale: "95",
      prescribedWeightFemale: "65",
      orderIndex: 0,
    },
    {
      id: "m2",
      movementId: "pull-up",
      movementName: "Pull-Up",
      category: "gymnastics",
      isWeighted: false,
      prescribedReps: "21-15-9",
      orderIndex: 1,
    },
  ],
};

function builderFormToWorkout(form: WorkoutBuilderForm, date: string): WorkoutDisplay {
  const movements: WorkoutMovementDisplay[] = form.movements.map((m, i) => ({
    id: m.tempId,
    movementId: m.movementId || m.tempId,
    movementName: m.movementName,
    category: m.category || "other",
    isWeighted: m.isWeighted,
    prescribedReps: m.prescribedReps || undefined,
    prescribedWeightMale: m.prescribedWeightMale || undefined,
    prescribedWeightFemale: m.prescribedWeightFemale || undefined,
    rxStandard: m.rxStandard || undefined,
    orderIndex: i,
  }));
  return {
    id: `workout-${Date.now()}`,
    title: form.title || undefined,
    description: form.description || undefined,
    workoutType: form.workoutType,
    workoutDate: date,
    timeCapSeconds: form.timeCapMinutes ? parseInt(form.timeCapMinutes) * 60 + parseInt(form.timeCapSeconds || "0") : undefined,
    amrapDurationSeconds: form.amrapDurationMinutes ? parseInt(form.amrapDurationMinutes) * 60 : undefined,
    repScheme: form.repScheme || undefined,
    movements,
    createdBy: "current-user",
  };
}

function parsedToWorkout(parsed: ParsedWorkout, date: string): WorkoutDisplay {
  const movements: WorkoutMovementDisplay[] = parsed.movements.map((m, i) => ({
    id: `pm-${Date.now()}-${i}`,
    movementId: `pm-${Date.now()}-${i}`,
    movementName: m.matchedCanonicalName || m.name,
    category: "other",
    isWeighted: !!(m.weightMale || m.weightFemale),
    prescribedReps: m.reps,
    prescribedWeightMale: m.weightMale?.toString(),
    prescribedWeightFemale: m.weightFemale?.toString(),
    orderIndex: i,
  }));
  return {
    id: `workout-${Date.now()}`,
    title: parsed.title,
    description: parsed.description,
    workoutType: parsed.workoutType,
    workoutDate: date,
    timeCapSeconds: parsed.timeCapSeconds,
    amrapDurationSeconds: parsed.amrapDurationSeconds,
    repScheme: parsed.repScheme,
    movements,
    createdBy: "current-user",
  };
}

function toDateString(d: Date) {
  return d.toISOString().split("T")[0];
}

export default function CrossfitPage() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [workouts, setWorkouts] = useState<WorkoutDisplay[]>([demoWorkout]);
  const [showAddWorkout, setShowAddWorkout] = useState(false);
  const [scoringWorkout, setScoringWorkout] = useState<WorkoutDisplay | null>(null);

  const dateStr = toDateString(selectedDate);
  const dayWorkouts = workouts.filter((w) => w.workoutDate === dateStr);

  const handleSaveFromBuilder = (form: WorkoutBuilderForm) => {
    setWorkouts([builderFormToWorkout(form, dateStr), ...workouts]);
    setShowAddWorkout(false);
  };

  const handleSaveFromParser = (parsed: ParsedWorkout) => {
    setWorkouts([parsedToWorkout(parsed, dateStr), ...workouts]);
    setShowAddWorkout(false);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Date navigator */}
      <DateNavigator selectedDate={selectedDate} onDateChange={setSelectedDate} />

      {/* Add workout button */}
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => setShowAddWorkout(true)}
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Add Workout
        </Button>
      </div>

      {/* Workouts for selected date */}
      {dayWorkouts.map((workout) => (
        <WorkoutCard
          key={workout.id}
          workout={workout}
          onLogScore={() => setScoringWorkout(workout)}
        />
      ))}

      {/* Empty state */}
      {dayWorkouts.length === 0 && (
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
            <Button variant="outline" className="mt-1 border-white/[0.08]" onClick={() => setShowAddWorkout(true)}>
              <Plus className="h-4 w-4" />
              Add Workout
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Add Workout Dialog */}
      <Dialog open={showAddWorkout} onOpenChange={setShowAddWorkout}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Workout</DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="paste">
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

      {/* Score Entry */}
      {scoringWorkout && (
        <ScoreEntry
          open
          onOpenChange={(open) => { if (!open) setScoringWorkout(null); }}
          workoutId={scoringWorkout.id}
          workoutTitle={scoringWorkout.title}
          workoutType={scoringWorkout.workoutType as WorkoutType}
          timeCapSeconds={scoringWorkout.timeCapSeconds}
          movements={scoringWorkout.movements}
          existingScore={scoringWorkout.score ?? undefined}
          onSubmit={(scoreInput: ScoreInput) => {
            const scoreDisplay: ScoreDisplay = {
              id: scoringWorkout.score?.id ?? `score-${Date.now()}`,
              division: scoreInput.division,
              timeSeconds: scoreInput.timeSeconds,
              rounds: scoreInput.rounds,
              remainderReps: scoreInput.remainderReps,
              weightLbs: scoreInput.weightLbs?.toString(),
              totalReps: scoreInput.totalReps,
              scoreText: scoreInput.scoreText,
              hitTimeCap: scoreInput.hitTimeCap,
              notes: scoreInput.notes,
              rpe: scoreInput.rpe,
            };
            setWorkouts((prev) =>
              prev.map((w) =>
                w.id === scoringWorkout.id ? { ...w, score: scoreDisplay } : w
              )
            );
            setScoringWorkout(null);
          }}
        />
      )}
    </div>
  );
}
