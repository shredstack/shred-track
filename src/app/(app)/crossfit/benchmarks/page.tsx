"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Search,
  Trophy,
  Plus,
  Loader2,
  Sparkles,
  CalendarDays,
  Star,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useBenchmarks,
  useBenchmarkHistory,
  useCreateRepMaxAttempt,
  useCreateWorkoutFromBenchmark,
} from "@/hooks/useBenchmarks";
import {
  WORKOUT_TYPE_LABELS,
  WORKOUT_TYPE_COLORS,
  BENCHMARK_CATEGORY_SHORT_LABELS,
  BENCHMARK_CATEGORY_COLORS,
  REP_MAX_TARGETS,
} from "@/types/crossfit";
import type {
  BenchmarkWorkout,
  BenchmarkCategoryName,
  BenchmarkAttempt,
  WorkoutType,
  BenchmarkMovement,
  BenchmarkWorkoutBlock,
  RepMaxStat,
  RepMaxTarget,
  WeightliftingBenchmarkHistory,
} from "@/types/crossfit";
import { WeightliftingBenchmarkTabs } from "@/components/crossfit/weightlifting-benchmark-tabs";
import { formatShortDate } from "@/lib/format-date";
import { formatBenchmarkAttempt } from "@/lib/crossfit/format-attempt";

// Pills mix two filter axes:
//   - "all" / "custom" filter by ownership (the existing /api/benchmarks
//     `category` param: system|custom|community).
//   - The named slugs (girls, heroes, …) filter by the benchmark's intrinsic
//     category column via the new `benchmarkCategory` param.
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

function toLocalDateString(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function BenchmarksPage() {
  const [search, setSearch] = useState("");
  const [pillFilter, setPillFilter] = useState<PillValue>("all");
  const [selected, setSelected] = useState<BenchmarkWorkout | null>(null);

  // Map the active pill onto the right query param. "all" leaves both
  // unset; "custom" filters by ownership; named slugs filter by the
  // benchmark's intrinsic category.
  const ownershipFilter = pillFilter === "custom" ? "custom" : undefined;
  const benchmarkCategoryFilter =
    pillFilter !== "all" && pillFilter !== "custom" ? pillFilter : undefined;

  const { data: benchmarks, isLoading } = useBenchmarks({
    search: search || undefined,
    category: ownershipFilter,
    benchmarkCategory: benchmarkCategoryFilter,
    includeStats: true,
  });

  const orderedBenchmarks = useMemo(() => {
    if (!benchmarks) return [];
    // Bubble benchmarks the user has already attempted to the top.
    return [...benchmarks].sort((a, b) => {
      const aAttempts = a.userStats?.attempts ?? 0;
      const bAttempts = b.userStats?.attempts ?? 0;
      if (aAttempts !== bAttempts) return bAttempts - aAttempts;
      return a.name.localeCompare(b.name);
    });
  }, [benchmarks]);

  const handleSelect = useCallback((b: BenchmarkWorkout) => {
    setSelected(b);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <Card className="overflow-hidden border-amber-500/20 bg-gradient-to-br from-amber-500/[0.06] to-transparent">
        <CardContent className="flex items-center gap-3 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
            <Trophy className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <p className="font-semibold">Benchmark WODs</p>
            <p className="text-xs text-muted-foreground">
              Track your PRs on Fran, Murph, Grace and more.
            </p>
          </div>
        </CardContent>
      </Card>

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

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : orderedBenchmarks.length === 0 ? (
        <Card className="border-dashed border-white/[0.06]">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No benchmarks found
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {orderedBenchmarks.map((b) => (
            <BenchmarkRow key={b.id} benchmark={b} onSelect={handleSelect} />
          ))}
        </div>
      )}

      {/* Detail dialog */}
      {selected && (
        <BenchmarkDetailDialog
          benchmark={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

// ============================================
// List row
// ============================================

function BenchmarkRow({
  benchmark,
  onSelect,
}: {
  benchmark: BenchmarkWorkout;
  onSelect: (b: BenchmarkWorkout) => void;
}) {
  const stats = benchmark.userStats;
  const isWeightlifting = !!benchmark.weightliftingMovementId;
  const movementSummary = useMemo(() => {
    if (isWeightlifting) {
      // The movement name is the benchmark name for weightlifting rows, so
      // repeating it as "Back Squat · Back Squat" reads as a bug. Skip the
      // movements line entirely — the rep-max grid below is the value.
      return "Rep-max benchmark · 1RM / 2RM / 3RM / 5RM";
    }
    const parts: string[] = [];
    if (benchmark.repScheme) parts.push(benchmark.repScheme);
    parts.push(benchmark.movements.map((m) => m.movementName).join(", "));
    return parts.filter(Boolean).join(" · ");
  }, [benchmark, isWeightlifting]);

  return (
    <button
      type="button"
      onClick={() => onSelect(benchmark)}
      className="flex w-full flex-col gap-2 rounded-lg border border-border/50 bg-muted/20 p-3 text-left transition-colors hover:bg-muted/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="font-semibold">{benchmark.name}</span>
          <p className="text-xs text-muted-foreground line-clamp-2">
            {movementSummary}
          </p>
        </div>
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

      {isWeightlifting ? (
        <RepMaxTeaserGrid stats={stats?.repMaxStats} />
      ) : stats && stats.attempts > 0 && stats.bestScore ? (
        <div className="flex items-center gap-2 pt-1">
          <Badge className="gap-1 bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/15">
            <Trophy className="size-3" />
            PR {stats.bestScore.display}
          </Badge>
          <span className="text-[11px] text-muted-foreground">
            {stats.attempts} attempt{stats.attempts === 1 ? "" : "s"}
            {stats.lastAttemptDate
              ? ` · last ${formatShortDate(stats.lastAttemptDate)}`
              : ""}
          </span>
        </div>
      ) : stats && stats.attempts === 0 ? (
        <div className="flex items-center gap-1 pt-1 text-[11px] text-muted-foreground">
          <Sparkles className="size-3" />
          Not yet logged
        </div>
      ) : null}
    </button>
  );
}

// Compact 4-up grid teaser for weightlifting benchmarks. Each cell shows
// the heaviest weight for that rep target or an em-dash when the athlete
// hasn't tested it. Drives discoverability of stale rep targets (e.g.
// "I haven't tested my 2RM in 6 months").
function RepMaxTeaserGrid({
  stats,
}: {
  stats: Partial<Record<RepMaxTarget, RepMaxStat>> | undefined;
}) {
  return (
    <div className="grid grid-cols-4 gap-1 pt-1">
      {REP_MAX_TARGETS.map((target) => {
        const s = stats?.[target];
        return (
          <div
            key={target}
            className="flex flex-col items-center justify-center rounded border border-border/40 bg-muted/20 px-1 py-1"
          >
            <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
              {target}RM
            </span>
            <span
              className={
                s
                  ? "text-xs font-semibold text-amber-200"
                  : "text-xs text-muted-foreground"
              }
            >
              {s ? `${s.weightLbs} lb` : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ============================================
// Detail dialog (browse + history + log new attempt)
// ============================================

// Renders a part's movements grouped by their optional block titles. When a
// part has no blocks (or every movement is ungrouped), this falls back to
// the flat numbered list that the dialog used pre-blocks.
function BenchmarkPartMovementList({
  blocks,
  movements,
}: {
  blocks: BenchmarkWorkoutBlock[];
  movements: BenchmarkMovement[];
}) {
  const ungrouped = movements.filter((m) => !m.blockId);
  const movementsByBlock = new Map<string, BenchmarkMovement[]>();
  for (const m of movements) {
    if (!m.blockId) continue;
    const list = movementsByBlock.get(m.blockId) ?? [];
    list.push(m);
    movementsByBlock.set(m.blockId, list);
  }
  const orderedBlocks = [...blocks].sort((a, b) => a.orderIndex - b.orderIndex);

  return (
    <div className="space-y-2">
      {ungrouped.length > 0 && (
        <BenchmarkMovementList movements={ungrouped} />
      )}
      {orderedBlocks.map((b) => {
        const blockMovements = movementsByBlock.get(b.id) ?? [];
        if (blockMovements.length === 0) return null;
        return (
          <div key={b.id} className="space-y-1">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {b.title}
            </h4>
            <BenchmarkMovementList movements={blockMovements} />
          </div>
        );
      })}
    </div>
  );
}

function BenchmarkMovementList({
  movements,
}: {
  movements: BenchmarkMovement[];
}) {
  return (
    <div className="space-y-1">
      {movements.map((m, i) => (
        <div key={m.id} className="flex items-baseline gap-2 text-sm">
          <span className="w-4 text-right text-xs text-muted-foreground">
            {i + 1}.
          </span>
          <span className="font-medium">{m.movementName}</span>
          {m.prescribedReps && (
            <span className="text-muted-foreground">{m.prescribedReps}</span>
          )}
          {(m.prescribedWeightMale || m.prescribedWeightFemale) && (
            <span className="text-xs text-muted-foreground">
              ({m.prescribedWeightMale}
              {m.prescribedWeightFemale ? `/${m.prescribedWeightFemale}` : ""}{" "}
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
  );
}

function BenchmarkDetailDialog({
  benchmark,
  onClose,
}: {
  benchmark: BenchmarkWorkout;
  onClose: () => void;
}) {
  const router = useRouter();
  const { data: history, isLoading: historyLoading } = useBenchmarkHistory(
    benchmark.id
  );
  const createWorkout = useCreateWorkoutFromBenchmark();
  const createRepMaxAttempt = useCreateRepMaxAttempt();
  const [date, setDate] = useState(toLocalDateString(new Date()));

  const isWeightlifting = !!benchmark.weightliftingMovementId;
  const wlHistory =
    history && "repMaxHistory" in history
      ? (history as WeightliftingBenchmarkHistory)
      : null;

  const handleLogAttempt = useCallback(() => {
    createWorkout.mutate(
      { benchmarkWorkoutId: benchmark.id, workoutDate: date },
      {
        onSuccess: () => {
          toast.success(`Added ${benchmark.name} to ${formatShortDate(date)}`, {
            description: "Tap WODs to log your score.",
          });
          onClose();
          // Deep-link to the day the workout was added to, not "today",
          // so the user lands directly on the new workout.
          router.push(`/crossfit?date=${date}`);
        },
        onError: (err) => {
          toast.error(
            err instanceof Error ? err.message : "Failed to add workout"
          );
        },
      }
    );
  }, [benchmark.id, benchmark.name, createWorkout, date, onClose, router]);

  const handleLogRepMaxAttempt = useCallback(
    (repTarget: RepMaxTarget) => {
      if (!benchmark.weightliftingMovementId) return;
      createRepMaxAttempt.mutate(
        {
          movementId: benchmark.weightliftingMovementId,
          movementName: benchmark.name,
          repTarget,
          workoutDate: date,
        },
        {
          onSuccess: () => {
            toast.success(
              `Added ${benchmark.name} ${repTarget}RM to ${formatShortDate(date)}`,
              { description: "Tap WODs to log your score." }
            );
            onClose();
            // Deep-link to the day the rep-max workout was added to.
            router.push(`/crossfit?date=${date}`);
          },
          onError: (err) => {
            toast.error(
              err instanceof Error ? err.message : "Failed to add workout"
            );
          },
        }
      );
    },
    [
      benchmark.name,
      benchmark.weightliftingMovementId,
      createRepMaxAttempt,
      date,
      onClose,
      router,
    ]
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="text-xl">{benchmark.name}</DialogTitle>
            <div className="flex flex-wrap items-center gap-1">
              {benchmark.category && (
                <Badge
                  variant="outline"
                  className={BENCHMARK_CATEGORY_COLORS[benchmark.category]}
                >
                  {BENCHMARK_CATEGORY_SHORT_LABELS[benchmark.category]}
                </Badge>
              )}
              {!isWeightlifting && benchmark.parts.length === 1 && (
                <Badge
                  variant="outline"
                  className={WORKOUT_TYPE_COLORS[benchmark.workoutType]}
                >
                  {WORKOUT_TYPE_LABELS[benchmark.workoutType]}
                </Badge>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {benchmark.description && (
            <p className="text-sm text-muted-foreground">
              {benchmark.description}
            </p>
          )}

          {isWeightlifting ? (
            // Weightlifting branch: skip the prescription block entirely
            // (the rep target is the prescription) and render rep-max tabs.
            <>
              <div className="space-y-2">
                <Label htmlFor="bench-date">Workout Date</Label>
                <Input
                  id="bench-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <CalendarDays className="size-3" />
                  Used when you log a new attempt below.
                </p>
              </div>

              <Separator />

              {historyLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <WeightliftingBenchmarkTabs
                  variants={wlHistory?.repMaxHistory.variants ?? []}
                  onLogAttempt={handleLogRepMaxAttempt}
                />
              )}

              {createRepMaxAttempt.isPending && (
                <p className="text-center text-xs text-muted-foreground">
                  Adding workout…
                </p>
              )}
            </>
          ) : (
            <>
              {/* Prescription — iterate parts so multi-part benchmarks (and
                  chipper-style benchmarks with blocks like Drew) render with
                  their proper structure. Single-part benchmarks collapse to
                  one section. */}
              <div className="space-y-3">
                {benchmark.parts.map((part, idx) => {
                  const showPartHeader = benchmark.parts.length > 1;
                  const partLabel =
                    part.label || `Part ${String.fromCharCode(65 + idx)}`;
                  return (
                    <div
                      key={part.id}
                      className={
                        showPartHeader
                          ? "rounded-md border border-border/40 bg-muted/20 p-3 space-y-2"
                          : "space-y-2"
                      }
                    >
                      {showPartHeader && (
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={WORKOUT_TYPE_COLORS[part.workoutType]}
                          >
                            {partLabel}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {WORKOUT_TYPE_LABELS[part.workoutType]}
                          </span>
                        </div>
                      )}

                      {part.repScheme && (
                        <p className="text-sm font-medium">{part.repScheme}</p>
                      )}
                      {part.rounds && (
                        <p className="text-xs text-muted-foreground">
                          {part.rounds} rounds
                        </p>
                      )}
                      {part.timeCapSeconds != null && (
                        <p className="text-xs text-muted-foreground">
                          Time cap: {Math.floor(part.timeCapSeconds / 60)} min
                        </p>
                      )}
                      {part.amrapDurationSeconds != null && (
                        <p className="text-xs text-muted-foreground">
                          Duration: {Math.floor(part.amrapDurationSeconds / 60)} min
                        </p>
                      )}

                      <BenchmarkPartMovementList
                        blocks={part.blocks}
                        movements={part.movements}
                      />
                    </div>
                  );
                })}
              </div>

              <Separator />

              {/* Legacy flat history */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Your History</h3>
                  {history && "attempts" in history && history.attempts.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {history.attempts.length} attempt
                      {history.attempts.length === 1 ? "" : "s"}
                    </span>
                  )}
                </div>

                {historyLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </div>
                ) : history && "attempts" in history && history.attempts.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    {history.attempts.map((a) => (
                      <AttemptRow
                        key={a.scoreId}
                        workoutType={benchmark.workoutType}
                        attempt={a}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="rounded-md border border-dashed border-white/[0.06] py-4 text-center text-xs text-muted-foreground">
                    No attempts yet — log one below to start tracking your PR.
                  </p>
                )}
              </div>

              <Separator />

              {/* Log new attempt */}
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="bench-date">Workout Date</Label>
                  <Input
                    id="bench-date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <CalendarDays className="size-3" />
                    Adds the workout to that day so you can log your score.
                  </p>
                </div>

                <Button
                  className="w-full"
                  onClick={handleLogAttempt}
                  disabled={createWorkout.isPending}
                >
                  <Plus className="size-4" />
                  {createWorkout.isPending
                    ? "Adding..."
                    : "Log this benchmark"}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================
// Attempt row inside history list
// ============================================

function AttemptRow({
  attempt,
  workoutType,
}: {
  attempt: BenchmarkAttempt;
  workoutType: WorkoutType;
}) {
  const display = formatBenchmarkAttempt(workoutType, attempt);
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2">
      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{display}</span>
          {attempt.isPR && (
            <Badge className="gap-1 bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/15">
              <Star className="size-3" />
              PR
            </Badge>
          )}
          {attempt.hitTimeCap && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              capped
            </Badge>
          )}
        </div>
        {attempt.notes && (
          <span className="text-[11px] text-muted-foreground line-clamp-1">
            {attempt.notes}
          </span>
        )}
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-xs text-muted-foreground">
          {formatShortDate(attempt.workoutDate)}
        </span>
        <Badge
          variant="outline"
          className="text-[10px] uppercase text-muted-foreground"
        >
          {attempt.division.replace("_", " ")}
        </Badge>
      </div>
    </div>
  );
}

