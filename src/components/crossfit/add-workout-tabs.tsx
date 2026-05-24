"use client";

// Shared 3-tab "Add Workout" body used by both the CrossFit tab and the
// gym programming admin. Callers own the save side-effects (POST a
// workout, PUT a programming section, etc.) — this component just wires
// up the Paste / Smart Builder / Benchmark UIs and forwards their output.
//
// The two callers differ mainly in what "save" means and which contextual
// fields make sense. The `lockedDate` + `hidePartner`/`hideVest` flags
// let the same component serve both flows without forking.

import { ClipboardPaste, Trophy, Wrench } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SmartBuilder } from "@/components/crossfit/smart-builder";
import { WorkoutParser } from "@/components/crossfit/workout-parser";
import { BenchmarkPicker } from "@/components/crossfit/benchmark-picker";
import type {
  BenchmarkWorkout,
  ParsedWorkout,
  WorkoutBuilderForm,
} from "@/types/crossfit";

export interface AddWorkoutTabsProps {
  defaultWorkoutDate?: string;
  onSaveFromBuilder: (form: WorkoutBuilderForm) => Promise<void> | void;
  onSaveFromParser: (
    parsed: ParsedWorkout,
    workoutDate: string,
    options: { isPartner: boolean; partnerCount: number | null }
  ) => Promise<void> | void;
  onSaveFromBenchmark: (
    benchmark: BenchmarkWorkout,
    workoutDate: string,
    options: { isPartner: boolean; partnerCount: number | null }
  ) => Promise<void> | void;
  onCancel?: () => void;

  // ---- Per-tab configuration ----
  // When set, the benchmark "Add" button shows this label and the picker
  // treats it as external-submit (loading state from `isBenchmarkSubmitting`).
  benchmarkSubmitLabel?: string;
  isBenchmarkSubmitting?: boolean;
  // Label for the Smart Builder's primary save action.
  builderSaveLabel?: string;
  // Label for the Parser's primary save action.
  parserSaveLabel?: string;

  // ---- Contextual controls shared across tabs ----
  // Hide the date input across all tabs (the parent owns the date — e.g.
  // a programming day card already knows which day it's editing).
  lockedDate?: boolean;
  // Hide the partner toggle across all tabs (programming sections leave
  // partner mode to the athlete at scoring time).
  hidePartner?: boolean;
  // Hide vest requirements in the Smart Builder (programming sections
  // leave vest gear to the athlete).
  hideVest?: boolean;

  // For the legacy CrossFit-tab benchmark behavior where the picker
  // creates the workout itself via /api/workouts. Forwarded to the picker
  // when `onSaveFromBenchmark` is not in "external" mode (the parent uses
  // the picker's built-in mutation by passing this `defaultBenchmarkMode`).
  // Most callers will use `onSaveFromBenchmark` instead and ignore this.
}

export function AddWorkoutTabs({
  defaultWorkoutDate,
  onSaveFromBuilder,
  onSaveFromParser,
  onSaveFromBenchmark,
  onCancel,
  benchmarkSubmitLabel,
  isBenchmarkSubmitting,
  builderSaveLabel,
  parserSaveLabel,
  lockedDate,
  hidePartner,
  hideVest,
}: AddWorkoutTabsProps) {
  return (
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
          onSave={onSaveFromParser}
          onCancel={onCancel}
          defaultWorkoutDate={defaultWorkoutDate}
          hideDateInput={lockedDate}
          hidePartner={hidePartner}
          saveLabel={parserSaveLabel}
        />
      </TabsContent>

      <TabsContent value="build" className="mt-4">
        <SmartBuilder
          defaultWorkoutDate={defaultWorkoutDate}
          onSave={onSaveFromBuilder}
          onCancel={onCancel}
          saveLabel={builderSaveLabel}
          hideDateInput={lockedDate}
          hidePartner={hidePartner}
          hideVest={hideVest}
        />
      </TabsContent>

      <TabsContent value="benchmark" className="mt-4">
        <BenchmarkPicker
          workoutDate={defaultWorkoutDate}
          onAdd={onSaveFromBenchmark}
          isSubmitting={isBenchmarkSubmitting}
          submitLabel={benchmarkSubmitLabel}
          hideDateInput={lockedDate}
          hidePartner={hidePartner}
        />
      </TabsContent>
    </Tabs>
  );
}
