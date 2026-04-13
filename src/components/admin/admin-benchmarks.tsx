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
import { Search, Plus, Pencil, Trash2, Loader2, Star } from "lucide-react";
import { WorkoutTypeSelector } from "@/components/crossfit/workout-type-selector";
import { MovementListBuilder } from "@/components/crossfit/movement-list-builder";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type {
  BenchmarkWorkout,
  WorkoutType,
  WorkoutBuilderMovement,
} from "@/types/crossfit";
import {
  WORKOUT_TYPE_LABELS,
  WORKOUT_TYPE_COLORS,
} from "@/types/crossfit";

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
  workoutType: WorkoutType;
  timeCapMinutes: string;
  amrapDurationMinutes: string;
  repScheme: string;
  isSystem: boolean;
  movements: WorkoutBuilderMovement[];
}

const emptyForm: BenchmarkFormState = {
  name: "",
  description: "",
  workoutType: "for_time",
  timeCapMinutes: "",
  amrapDurationMinutes: "",
  repScheme: "",
  isSystem: false,
  movements: [],
};

function generateTempId() {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function AdminBenchmarks() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BenchmarkFormState>(emptyForm);
  const [error, setError] = useState("");

  const { data: benchmarks, isLoading } = useAdminBenchmarks();

  const filtered = benchmarks?.filter(
    (b) =>
      !search ||
      b.name.toLowerCase().includes(search.toLowerCase())
  );

  const saveMutation = useMutation({
    mutationFn: async (data: { id?: string; form: BenchmarkFormState }) => {
      const url = data.id
        ? `/api/admin/benchmarks/${data.id}`
        : "/api/admin/benchmarks";

      const payload = {
        name: data.form.name,
        description: data.form.description || undefined,
        workoutType: data.form.workoutType,
        timeCapSeconds: data.form.timeCapMinutes
          ? parseInt(data.form.timeCapMinutes) * 60
          : undefined,
        amrapDurationSeconds: data.form.amrapDurationMinutes
          ? parseInt(data.form.amrapDurationMinutes) * 60
          : undefined,
        repScheme: data.form.repScheme || undefined,
        isSystem: data.form.isSystem,
        movements: data.form.movements
          .filter((m) => m.movementId)
          .map((m, i) => ({
            movementId: m.movementId,
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

      const res = await fetch(url, {
        method: data.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-benchmarks"] });
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
    },
  });

  const openCreate = useCallback(() => {
    setForm(emptyForm);
    setEditingId(null);
    setError("");
    setShowForm(true);
  }, []);

  const openEdit = useCallback((b: BenchmarkWorkout) => {
    setForm({
      name: b.name,
      description: b.description || "",
      workoutType: b.workoutType,
      timeCapMinutes: b.timeCapSeconds
        ? String(Math.floor(b.timeCapSeconds / 60))
        : "",
      amrapDurationMinutes: b.amrapDurationSeconds
        ? String(Math.floor(b.amrapDurationSeconds / 60))
        : "",
      repScheme: b.repScheme || "",
      isSystem: b.isSystem,
      movements: b.movements.map((m) => ({
        tempId: generateTempId(),
        movementId: m.movementId,
        movementName: m.movementName,
        isWeighted: !!(m.prescribedWeightMale || m.prescribedWeightFemale),
        prescribedReps: m.prescribedReps || "",
        prescribedWeightMale: m.prescribedWeightMale?.toString() || "",
        prescribedWeightFemale: m.prescribedWeightFemale?.toString() || "",
        rxStandard: m.rxStandard || "",
        notes: "",
      })),
    });
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

  return (
    <div className="space-y-4">
      {/* Search + Add */}
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
                <div className="flex items-center gap-2">
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

            <div className="space-y-2">
              <Label>Workout Type</Label>
              <WorkoutTypeSelector
                value={form.workoutType}
                onSelect={(type) =>
                  setForm((prev) => ({ ...prev, workoutType: type }))
                }
              />
            </div>

            {(form.workoutType === "for_time" || form.workoutType === "emom") && (
              <div className="space-y-2">
                <Label>
                  {form.workoutType === "emom"
                    ? "Duration (min)"
                    : "Time Cap (min)"}
                </Label>
                <Input
                  type="number"
                  min={0}
                  value={form.timeCapMinutes}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      timeCapMinutes: e.target.value,
                    }))
                  }
                  placeholder="Optional"
                />
              </div>
            )}

            {form.workoutType === "amrap" && (
              <div className="space-y-2">
                <Label>AMRAP Duration (min)</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.amrapDurationMinutes}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      amrapDurationMinutes: e.target.value,
                    }))
                  }
                  placeholder="e.g. 12"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>Rep Scheme</Label>
              <Input
                value={form.repScheme}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, repScheme: e.target.value }))
                }
                placeholder="e.g. 21-15-9 or 5 rounds"
              />
            </div>

            <Separator />

            <MovementListBuilder
              movements={form.movements}
              onChange={(movements) =>
                setForm((prev) => ({ ...prev, movements }))
              }
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
