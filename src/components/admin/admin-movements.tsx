"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Search, Plus, Pencil, Trash2, Video, Loader2 } from "lucide-react";
import {
  MOVEMENT_CATEGORIES,
  MOVEMENT_CATEGORY_COLORS,
  type MovementCategory,
} from "@/types/crossfit";

interface Movement {
  id: string;
  canonicalName: string;
  category: string;
  isWeighted: boolean;
  is1rmApplicable: boolean;
  commonRxWeightMale: string | null;
  commonRxWeightFemale: string | null;
  videoUrl: string | null;
}

function useAdminMovements(search?: string) {
  return useQuery<Movement[]>({
    queryKey: ["admin-movements", search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await fetch(`/api/admin/movements?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });
}

interface MovementFormData {
  canonicalName: string;
  category: MovementCategory;
  isWeighted: boolean;
  is1rmApplicable: boolean;
  commonRxWeightMale: string;
  commonRxWeightFemale: string;
  videoUrl: string;
}

const emptyForm: MovementFormData = {
  canonicalName: "",
  category: "barbell",
  isWeighted: false,
  is1rmApplicable: false,
  commonRxWeightMale: "",
  commonRxWeightFemale: "",
  videoUrl: "",
};

export function AdminMovements() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<MovementFormData>(emptyForm);
  const [error, setError] = useState("");

  const { data: movements, isLoading } = useAdminMovements(search || undefined);

  const saveMutation = useMutation({
    mutationFn: async (data: { id?: string; form: MovementFormData }) => {
      const url = data.id
        ? `/api/admin/movements/${data.id}`
        : "/api/admin/movements";
      const res = await fetch(url, {
        method: data.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data.form),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-movements"] });
      closeForm();
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/movements/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-movements"] });
    },
  });

  const openCreate = useCallback(() => {
    setForm(emptyForm);
    setEditingId(null);
    setError("");
    setShowForm(true);
  }, []);

  const openEdit = useCallback((m: Movement) => {
    setForm({
      canonicalName: m.canonicalName,
      category: m.category as MovementCategory,
      isWeighted: m.isWeighted,
      is1rmApplicable: m.is1rmApplicable,
      commonRxWeightMale: m.commonRxWeightMale || "",
      commonRxWeightFemale: m.commonRxWeightFemale || "",
      videoUrl: m.videoUrl || "",
    });
    setEditingId(m.id);
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
            placeholder="Search movements..."
            className="pl-9"
          />
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus className="size-4" />
          Add
        </Button>
      </div>

      {/* Movement list */}
      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground mb-2">
            {movements?.length || 0} movements
          </p>
          {movements?.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">
                    {m.canonicalName}
                  </span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${MOVEMENT_CATEGORY_COLORS[m.category as MovementCategory] || ""}`}
                  >
                    {m.category}
                  </Badge>
                  {m.videoUrl && (
                    <Video className="size-3 text-muted-foreground" />
                  )}
                </div>
                {(m.commonRxWeightMale || m.commonRxWeightFemale) && (
                  <p className="text-[10px] text-muted-foreground">
                    Rx: {m.commonRxWeightMale || "—"}/{m.commonRxWeightFemale || "—"} lb
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => openEdit(m)}
              >
                <Pencil className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  if (confirm(`Delete "${m.canonicalName}"?`)) {
                    deleteMutation.mutate(m.id);
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit Movement" : "Add Movement"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="am-name">Name</Label>
              <Input
                id="am-name"
                value={form.canonicalName}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, canonicalName: e.target.value }))
                }
                placeholder="e.g. Thruster"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={form.category}
                onValueChange={(val) =>
                  setForm((prev) => ({
                    ...prev,
                    category: val as MovementCategory,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MOVEMENT_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch
                  id="am-weighted"
                  checked={form.isWeighted}
                  onCheckedChange={(checked) =>
                    setForm((prev) => ({ ...prev, isWeighted: checked }))
                  }
                />
                <Label htmlFor="am-weighted" className="text-sm">
                  Weighted
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="am-1rm"
                  checked={form.is1rmApplicable}
                  onCheckedChange={(checked) =>
                    setForm((prev) => ({ ...prev, is1rmApplicable: checked }))
                  }
                />
                <Label htmlFor="am-1rm" className="text-sm">
                  1RM Applicable
                </Label>
              </div>
            </div>

            {form.isWeighted && (
              <div className="grid gap-3 grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="am-rxm">Rx Weight (M)</Label>
                  <Input
                    id="am-rxm"
                    value={form.commonRxWeightMale}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        commonRxWeightMale: e.target.value,
                      }))
                    }
                    placeholder="e.g. 135"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="am-rxf">Rx Weight (F)</Label>
                  <Input
                    id="am-rxf"
                    value={form.commonRxWeightFemale}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        commonRxWeightFemale: e.target.value,
                      }))
                    }
                    placeholder="e.g. 95"
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="am-video">Video URL</Label>
              <Input
                id="am-video"
                type="url"
                value={form.videoUrl}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, videoUrl: e.target.value }))
                }
                placeholder="https://youtube.com/watch?v=..."
              />
            </div>

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
