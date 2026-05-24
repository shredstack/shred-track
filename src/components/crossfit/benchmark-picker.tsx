"use client";

import { useState, useMemo, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, Plus, Loader2 } from "lucide-react";
import { useBenchmarks, useCreateBenchmark, useCreateWorkoutFromBenchmark } from "@/hooks/useBenchmarks";
import { BenchmarkPreview } from "@/components/crossfit/benchmark-preview";
import { BenchmarkForm } from "@/components/crossfit/benchmark-form";
import type { BenchmarkWorkout, BenchmarkCategoryName } from "@/types/crossfit";
import {
  WORKOUT_TYPE_LABELS,
  WORKOUT_TYPE_COLORS,
  BENCHMARK_CATEGORY_SHORT_LABELS,
  BENCHMARK_CATEGORY_COLORS,
} from "@/types/crossfit";

interface BenchmarkPickerProps {
  workoutDate?: string;
  // Default mode (no `onAdd`): pressing "Add Workout" creates a workout
  // for the user via /api/workouts. `onWorkoutCreated` is the success
  // callback and `communityId` writes it into a gym (only valid when the
  // viewer is a coach/admin; the API rejects it otherwise).
  onWorkoutCreated?: () => void;
  communityId?: string | null;
  // Override mode (`onAdd` provided): the picker emits the selected
  // benchmark + options instead of calling its own mutation. The parent
  // owns saving (e.g. writing to a programming section). `onWorkoutCreated`
  // and `communityId` are ignored in this mode.
  onAdd?: (
    benchmark: BenchmarkWorkout,
    workoutDate: string,
    options: { isPartner: boolean; partnerCount: number | null }
  ) => Promise<void> | void;
  // External loading state for the Add button when the parent owns the
  // submit. Ignored in default mode (the picker tracks its own mutation).
  isSubmitting?: boolean;
  // Label for the primary Add button (default "Add Workout").
  submitLabel?: string;
  // When true, hide the workout-date input (parent provides the date and
  // the field would just confuse — e.g. programming has a fixed day).
  hideDateInput?: boolean;
  // When true, hide the partner toggle (e.g. programming sections —
  // partner mode is a per-athlete scoring decision, not a programmed
  // attribute).
  hidePartner?: boolean;
}

type View = "list" | "preview" | "create";

// Pills mix two filter axes:
//   - "all" / "custom" filter by ownership (the /api/benchmarks `category`
//     param: system|custom|community).
//   - The named slugs (girls, heroes, …) filter by the benchmark's intrinsic
//     category column via the `benchmarkCategory` param.
type PillValue = "all" | "custom" | BenchmarkCategoryName;

const CATEGORY_PILLS: { value: PillValue; label: string }[] = [
  { value: "all", label: "All" },
  { value: "girls", label: "Girls" },
  { value: "heroes", label: "Hero" },
  { value: "open", label: "CF Open" },
  { value: "weightlifting", label: "Weightlifting" },
  { value: "gym_benchmark", label: "Gym" },
  { value: "custom", label: "Custom" },
];

export function BenchmarkPicker({
  onWorkoutCreated,
  workoutDate,
  communityId,
  onAdd,
  isSubmitting,
  submitLabel,
  hideDateInput,
  hidePartner,
}: BenchmarkPickerProps) {
  const [view, setView] = useState<View>("list");
  const [search, setSearch] = useState("");
  const [pillFilter, setPillFilter] = useState<PillValue>("all");
  const [selectedBenchmark, setSelectedBenchmark] = useState<BenchmarkWorkout | null>(null);

  const ownershipFilter = pillFilter === "custom" ? "custom" : undefined;
  const benchmarkCategoryFilter =
    pillFilter !== "all" && pillFilter !== "custom" ? pillFilter : undefined;

  const { data: benchmarks, isLoading } = useBenchmarks({
    search: search || undefined,
    category: ownershipFilter,
    benchmarkCategory: benchmarkCategoryFilter,
  });

  const createBenchmark = useCreateBenchmark();
  const createWorkout = useCreateWorkoutFromBenchmark();

  const handleSelectBenchmark = useCallback((benchmark: BenchmarkWorkout) => {
    setSelectedBenchmark(benchmark);
    setView("preview");
  }, []);

  const handleAddWorkout = useCallback(
    async (
      benchmarkId: string,
      date: string,
      options: { isPartner: boolean; partnerCount: number | null }
    ) => {
      if (onAdd) {
        const benchmark = selectedBenchmark;
        if (!benchmark || benchmark.id !== benchmarkId) return;
        await onAdd(benchmark, date, options);
        return;
      }
      createWorkout.mutate(
        {
          benchmarkWorkoutId: benchmarkId,
          workoutDate: date,
          communityId: communityId ?? undefined,
          isPartner: options.isPartner,
          partnerCount: options.partnerCount ?? undefined,
        },
        { onSuccess: () => onWorkoutCreated?.() }
      );
    },
    [createWorkout, onWorkoutCreated, communityId, onAdd, selectedBenchmark]
  );

  const handleCreateBenchmark = useCallback(
    (data: Parameters<typeof createBenchmark.mutate>[0]) => {
      createBenchmark.mutate(data, {
        onSuccess: () => setView("list"),
      });
    },
    [createBenchmark]
  );

  // List view
  if (view === "create") {
    return (
      <BenchmarkForm
        onSave={handleCreateBenchmark}
        onCancel={() => setView("list")}
        isLoading={createBenchmark.isPending}
      />
    );
  }

  if (view === "preview" && selectedBenchmark) {
    return (
      <BenchmarkPreview
        benchmark={selectedBenchmark}
        onAdd={handleAddWorkout}
        onBack={() => setView("list")}
        isLoading={onAdd ? !!isSubmitting : createWorkout.isPending}
        defaultWorkoutDate={workoutDate}
        submitLabel={submitLabel}
        hideDateInput={hideDateInput}
        hidePartner={hidePartner}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search benchmarks..."
          className="pl-9"
        />
      </div>

      {/* Category pills */}
      <div className="flex gap-1.5 flex-wrap">
        {CATEGORY_PILLS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setPillFilter(value)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              pillFilter === value
                ? "bg-primary text-primary-foreground"
                : "bg-muted/50 text-muted-foreground hover:bg-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Benchmark list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {benchmarks?.map((benchmark) => (
            <button
              key={benchmark.id}
              type="button"
              onClick={() => handleSelectBenchmark(benchmark)}
              className="flex w-full flex-col gap-1 rounded-lg border border-border/50 bg-muted/20 p-3 text-left transition-colors hover:bg-muted/40"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold">{benchmark.name}</span>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${WORKOUT_TYPE_COLORS[benchmark.workoutType]}`}
                  >
                    {WORKOUT_TYPE_LABELS[benchmark.workoutType]}
                  </Badge>
                  {benchmark.category && (
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${BENCHMARK_CATEGORY_COLORS[benchmark.category]}`}
                    >
                      {BENCHMARK_CATEGORY_SHORT_LABELS[benchmark.category]}
                    </Badge>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {benchmark.repScheme && `${benchmark.repScheme}: `}
                {benchmark.movements.map((m) => m.movementName).join(", ")}
              </p>
              {benchmark.movements.some(
                (m) => m.prescribedWeightMale || m.prescribedWeightFemale
              ) && (
                <p className="text-[10px] text-muted-foreground">
                  Rx:{" "}
                  {benchmark.movements
                    .filter((m) => m.prescribedWeightMale)
                    .map(
                      (m) =>
                        `${m.movementName} ${m.prescribedWeightMale}/${m.prescribedWeightFemale} lb`
                    )
                    .join(", ")}
                </p>
              )}
            </button>
          ))}

          {benchmarks?.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No benchmarks found
            </p>
          )}
        </div>
      )}

      {/* Create new benchmark */}
      <Button
        variant="outline"
        className="w-full border-dashed"
        onClick={() => setView("create")}
      >
        <Plus className="size-4" />
        Create New Benchmark
      </Button>
    </div>
  );
}
