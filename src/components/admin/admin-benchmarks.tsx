"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Plus, Pencil, Trash2, Loader2, Star } from "lucide-react";
import { WorkoutPartConfig } from "@/components/crossfit/workout-part-config";
import { VestRequirements } from "@/components/crossfit/vest-requirements";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type {
  BenchmarkWorkout,
  BenchmarkCategoryName,
  WorkoutBuilderPart,
  WorkoutBuilderMovement,
} from "@/types/crossfit";
import {
  WORKOUT_TYPE_LABELS,
  WORKOUT_TYPE_COLORS,
  BENCHMARK_CATEGORIES,
  BENCHMARK_CATEGORY_LABELS,
  BENCHMARK_CATEGORY_SHORT_LABELS,
  BENCHMARK_CATEGORY_COLORS,
} from "@/types/crossfit";

const NO_CATEGORY = "__none__";
const NO_CATEGORY_FILTER = "__all__";

function useAdminBenchmarks() {
  return useQuery<BenchmarkWorkout[]>({
    queryKey: ["admin-benchmarks"],
    queryFn: async () => {
      const res = await fetch("/api/admin/benchmarks");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });
}

interface BenchmarkFormState {
  name: string;
  description: string;
  category: BenchmarkCategoryName | null;
  isSystem: boolean;
  // Vest requirement applies to the whole benchmark (Murph, Chad).
  requiresVest: boolean;
  vestWeightMaleLb: string;
  vestWeightFemaleLb: string;
  // Part configuration (workout type, time cap, AMRAP duration, EMOM
  // interval, rounds, structure, repScheme, movements) is held in the same
  // shape the Smart Builder uses, so the WorkoutPartConfig component can
  // render it directly. A benchmark is always single-part.
  part: WorkoutBuilderPart;
}

function generateId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyPart(): WorkoutBuilderPart {
  return {
    tempId: generateId("part"),
    label: "",
    workoutType: "for_time",
    timeCapMinutes: "",
    amrapDurationMinutes: "",
    emomIntervalSeconds: "",
    intervalWorkSeconds: "",
    intervalRestSeconds: "",
    repScheme: "",
    rounds: "",
    movements: [],
  };
}

const emptyForm: BenchmarkFormState = {
  name: "",
  description: "",
  category: null,
  isSystem: false,
  requiresVest: false,
  vestWeightMaleLb: "",
  vestWeightFemaleLb: "",
  part: emptyPart(),
};

// Convert an existing benchmark into the BenchmarkFormState the form drives.
function benchmarkToForm(b: BenchmarkWorkout): BenchmarkFormState {
  const movements: WorkoutBuilderMovement[] = b.movements.map((m) => {
    const isWeighted = !!(m.prescribedWeightMale || m.prescribedWeightFemale);
    return {
      tempId: generateId("mov"),
      movementId: m.movementId,
      movementName: m.movementName,
      isWeighted,
      // Best-effort metric type inference: benchmarks only carry the
      // gendered weight pair, not the underlying movement's metric type.
      // Anything with a weight is "weight"; everything else is "reps".
      metricType: isWeighted ? "weight" : "reps",
      prescribedReps: m.prescribedReps || "",
      prescribedWeightMale: m.prescribedWeightMale?.toString() || "",
      prescribedWeightFemale: m.prescribedWeightFemale?.toString() || "",
      prescribedCaloriesMale: "",
      prescribedCaloriesFemale: "",
      prescribedDistanceMale: "",
      prescribedDistanceFemale: "",
      prescribedDurationSecondsMale: "",
      prescribedDurationSecondsFemale: "",
      prescribedHeightInches: "",
      prescribedWeightMaleBwMultiplier: "",
      prescribedWeightFemaleBwMultiplier: "",
      tempo: "",
      rxStandard: m.rxStandard || "",
      notes: "",
    };
  });

  return {
    name: b.name,
    description: b.description || "",
    category: b.category,
    isSystem: b.isSystem,
    requiresVest: !!b.requiresVest,
    vestWeightMaleLb:
      b.vestWeightMaleLb != null ? String(b.vestWeightMaleLb) : "",
    vestWeightFemaleLb:
      b.vestWeightFemaleLb != null ? String(b.vestWeightFemaleLb) : "",
    part: {
      tempId: generateId("part"),
      label: "",
      workoutType: b.workoutType,
      timeCapMinutes: b.timeCapSeconds
        ? String(Math.floor(b.timeCapSeconds / 60))
        : "",
      amrapDurationMinutes: b.amrapDurationSeconds
        ? String(Math.floor(b.amrapDurationSeconds / 60))
        : "",
      emomIntervalSeconds: "",
      intervalWorkSeconds: "",
      intervalRestSeconds: "",
      repScheme: b.repScheme || "",
      rounds: "",
      movements,
    },
  };
}

// Convert the form state into the API payload.
function formToPayload(form: BenchmarkFormState) {
  return {
    name: form.name,
    description: form.description || undefined,
    category: form.category ?? null,
    isSystem: form.isSystem,
    workoutType: form.part.workoutType,
    timeCapSeconds: form.part.timeCapMinutes
      ? parseInt(form.part.timeCapMinutes, 10) * 60
      : undefined,
    amrapDurationSeconds: form.part.amrapDurationMinutes
      ? parseInt(form.part.amrapDurationMinutes, 10) * 60
      : undefined,
    repScheme: form.part.repScheme || undefined,
    requiresVest: form.requiresVest,
    vestWeightMaleLb: form.vestWeightMaleLb
      ? Number(form.vestWeightMaleLb)
      : undefined,
    vestWeightFemaleLb: form.vestWeightFemaleLb
      ? Number(form.vestWeightFemaleLb)
      : undefined,
    movements: form.part.movements
      .filter((m) => m.movementId)
      .map((m, i) => ({
        movementId: m.movementId!,
        orderIndex: i,
        prescribedReps: m.prescribedReps || undefined,
        prescribedWeightMale: m.prescribedWeightMale
          ? Number(m.prescribedWeightMale)
          : undefined,
        prescribedWeightFemale: m.prescribedWeightFemale
          ? Number(m.prescribedWeightFemale)
          : undefined,
        rxStandard: m.rxStandard || undefined,
      })),
  };
}

export function AdminBenchmarks() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<
    BenchmarkCategoryName | typeof NO_CATEGORY_FILTER
  >(NO_CATEGORY_FILTER);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BenchmarkFormState>(emptyForm);
  const [error, setError] = useState("");

  const { data: benchmarks, isLoading } = useAdminBenchmarks();

  const filtered = benchmarks?.filter((b) => {
    if (search && !b.name.toLowerCase().includes(search.toLowerCase()))
      return false;
    if (categoryFilter !== NO_CATEGORY_FILTER && b.category !== categoryFilter)
      return false;
    return true;
  });

  const saveMutation = useMutation({
    mutationFn: async (data: { id?: string; form: BenchmarkFormState }) => {
      const url = data.id
        ? `/api/admin/benchmarks/${data.id}`
        : "/api/admin/benchmarks";

      const res = await fetch(url, {
        method: data.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToPayload(data.form)),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-benchmarks"] });
      // Also invalidate the user-facing list so it picks up admin changes.
      queryClient.invalidateQueries({ queryKey: ["benchmarks"] });
      closeForm();
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/benchmarks/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-benchmarks"] });
      queryClient.invalidateQueries({ queryKey: ["benchmarks"] });
    },
  });

  const openCreate = useCallback(() => {
    setForm({ ...emptyForm, part: emptyPart() });
    setEditingId(null);
    setError("");
    setShowForm(true);
  }, []);

  const openEdit = useCallback((b: BenchmarkWorkout) => {
    setForm(benchmarkToForm(b));
    setEditingId(b.id);
    setError("");
    setShowForm(true);
  }, []);

  const closeForm = useCallback(() => {
    setShowForm(false);
    setEditingId(null);
    setError("");
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      saveMutation.mutate({ id: editingId || undefined, form });
    },
    [editingId, form, saveMutation]
  );

  const updatePart = useCallback((updates: Partial<WorkoutBuilderPart>) => {
    setForm((prev) => ({ ...prev, part: { ...prev.part, ...updates } }));
  }, []);

  const updatePartMovements = useCallback(
    (movements: WorkoutBuilderMovement[]) => {
      setForm((prev) => ({ ...prev, part: { ...prev.part, movements } }));
    },
    []
  );

  return (
    <div className="space-y-4">
      {/* Search + Category filter + Add */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search benchmarks..."
            className="pl-9"
          />
        </div>
        <Select
          value={categoryFilter}
          onValueChange={(v) =>
            setCategoryFilter(v as BenchmarkCategoryName | typeof NO_CATEGORY_FILTER)
          }
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_CATEGORY_FILTER}>All categories</SelectItem>
            {BENCHMARK_CATEGORIES.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {BENCHMARK_CATEGORY_LABELS[cat]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={openCreate} size="sm">
          <Plus className="size-4" />
          Add
        </Button>
      </div>

      {/* Benchmark list */}
      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground mb-2">
            {filtered?.length || 0} benchmarks
          </p>
          {filtered?.map((b) => (
            <div
              key={b.id}
              className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium truncate">
                    {b.name}
                  </span>
                  {b.isSystem && (
                    <Star className="size-3 text-amber-400 fill-amber-400" />
                  )}
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${WORKOUT_TYPE_COLORS[b.workoutType]}`}
                  >
                    {WORKOUT_TYPE_LABELS[b.workoutType]}
                  </Badge>
                  {b.category && (
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${BENCHMARK_CATEGORY_COLORS[b.category]}`}
                    >
                      {BENCHMARK_CATEGORY_SHORT_LABELS[b.category]}
                    </Badge>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground truncate">
                  {b.repScheme && `${b.repScheme}: `}
                  {b.movements.map((m) => m.movementName).join(", ")}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => openEdit(b)}
              >
                <Pencil className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  if (confirm(`Delete "${b.name}"?`)) {
                    deleteMutation.mutate(b.id);
                  }
                }}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) closeForm(); }}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit Benchmark" : "Add Benchmark"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ab-name">Name</Label>
              <Input
                id="ab-name"
                value={form.name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="e.g. Fran"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ab-desc">Description</Label>
              <Textarea
                id="ab-desc"
                value={form.description}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, description: e.target.value }))
                }
                placeholder="Origin, notes..."
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ab-cat">Category</Label>
              <Select
                value={form.category ?? NO_CATEGORY}
                onValueChange={(v) =>
                  setForm((prev) => ({
                    ...prev,
                    category:
                      v === NO_CATEGORY ? null : (v as BenchmarkCategoryName),
                  }))
                }
              >
                <SelectTrigger id="ab-cat">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CATEGORY}>None</SelectItem>
                  {BENCHMARK_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {BENCHMARK_CATEGORY_LABELS[cat]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="ab-system"
                checked={form.isSystem}
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, isSystem: checked }))
                }
              />
              <Label htmlFor="ab-system" className="text-sm">
                System benchmark (visible to all users)
              </Label>
            </div>

            <Separator />

            <WorkoutPartConfig
              part={form.part}
              onChange={updatePart}
              onMovementsChange={updatePartMovements}
              showRepScheme
            />

            <VestRequirements
              requiresVest={form.requiresVest}
              vestWeightMaleLb={form.vestWeightMaleLb}
              vestWeightFemaleLb={form.vestWeightFemaleLb}
              onChange={(updates) =>
                setForm((prev) => ({ ...prev, ...updates }))
              }
              compact
            />

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <div className="flex gap-2">
              <Button
                type="submit"
                className="flex-1"
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending
                  ? "Saving..."
                  : editingId
                    ? "Update"
                    : "Create"}
              </Button>
              <Button type="button" variant="outline" onClick={closeForm}>
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
