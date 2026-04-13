"use client";

import { useState, useMemo, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, Plus, Loader2 } from "lucide-react";
import { useBenchmarks, useCreateBenchmark, useCreateWorkoutFromBenchmark } from "@/hooks/useBenchmarks";
import { BenchmarkPreview } from "@/components/crossfit/benchmark-preview";
import { BenchmarkForm } from "@/components/crossfit/benchmark-form";
import type { BenchmarkWorkout, BenchmarkCategory } from "@/types/crossfit";
import { WORKOUT_TYPE_LABELS, WORKOUT_TYPE_COLORS } from "@/types/crossfit";

interface BenchmarkPickerProps {
  onWorkoutCreated: () => void;
  workoutDate?: string;
}

type View = "list" | "preview" | "create";

const CATEGORY_PILLS: { value: BenchmarkCategory | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "system", label: "The Girls & Heroes" },
  { value: "custom", label: "Custom" },
];

export function BenchmarkPicker({
  onWorkoutCreated,
  workoutDate,
}: BenchmarkPickerProps) {
  const [view, setView] = useState<View>("list");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<BenchmarkCategory | "all">("all");
  const [selectedBenchmark, setSelectedBenchmark] = useState<BenchmarkWorkout | null>(null);

  const queryCategory = categoryFilter === "all" ? undefined : categoryFilter;
  const { data: benchmarks, isLoading } = useBenchmarks({
    search: search || undefined,
    category: queryCategory,
  });

  const createBenchmark = useCreateBenchmark();
  const createWorkout = useCreateWorkoutFromBenchmark();

  const handleSelectBenchmark = useCallback((benchmark: BenchmarkWorkout) => {
    setSelectedBenchmark(benchmark);
    setView("preview");
  }, []);

  const handleAddWorkout = useCallback(
    (benchmarkId: string, date: string) => {
      createWorkout.mutate(
        { benchmarkWorkoutId: benchmarkId, workoutDate: date },
        { onSuccess: () => onWorkoutCreated() }
      );
    },
    [createWorkout, onWorkoutCreated]
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
        isLoading={createWorkout.isPending}
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
            onClick={() => setCategoryFilter(value)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              categoryFilter === value
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
              <div className="flex items-center justify-between">
                <span className="font-semibold">{benchmark.name}</span>
                <Badge
                  variant="outline"
                  className={`text-[10px] ${WORKOUT_TYPE_COLORS[benchmark.workoutType]}`}
                >
                  {WORKOUT_TYPE_LABELS[benchmark.workoutType]}
                </Badge>
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
