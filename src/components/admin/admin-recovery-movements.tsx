"use client";

import { useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  Video,
  Loader2,
  CheckCircle2,
  ShieldAlert,
  ExternalLink,
  Save,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import { CategoryPills } from "@/components/shared/category-pills";
import {
  RECOVERY_CATEGORIES,
  RECOVERY_BODY_REGIONS,
  RECOVERY_CATEGORY_FILTER_OPTIONS,
  type RecoveryCategory,
  type RecoveryBodyRegion,
  type RecoveryCategoryFilter,
  type RecoveryMovement,
  type RecoveryVideo,
  type RecoveryPrescription,
} from "@/types/recovery";
import {
  useRecoveryMovements,
  useCreateRecoveryMovement,
  useUpdateRecoveryMovement,
  useDeleteRecoveryMovement,
  useValidateRecoveryMovement,
  useRecoveryMovementVideos,
  useUpdateRecoveryVideo,
  useDeleteRecoveryVideo,
} from "@/hooks/useRecoveryMovements";

type StatusFilter = "all" | "pending" | "validated";

interface FormData {
  canonicalName: string;
  category: RecoveryCategory;
  bodyRegion: RecoveryBodyRegion[];
  description: string;
  isPerSide: boolean;
  prescription: RecoveryPrescription;
}

const emptyForm: FormData = {
  canonicalName: "",
  category: "stretch",
  bodyRegion: [],
  description: "",
  isPerSide: false,
  prescription: {},
};

const formatLabel = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function AdminRecoveryMovements() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [category, setCategory] = useState<RecoveryCategoryFilter>("all");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [error, setError] = useState("");

  const { data: movements, isLoading } = useRecoveryMovements({
    q: search || undefined,
    category: category === "all" ? undefined : category,
    pendingOnly: status === "pending" ? true : undefined,
  });

  const filtered = useMemo(() => {
    if (!movements) return [];
    if (status === "validated") return movements.filter((m) => m.isValidated);
    return movements;
  }, [movements, status]);

  const createMutation = useCreateRecoveryMovement();
  const updateMutation = useUpdateRecoveryMovement();
  const deleteMutation = useDeleteRecoveryMovement();
  const validateMutation = useValidateRecoveryMovement();

  const openCreate = useCallback(() => {
    setForm(emptyForm);
    setEditingId(null);
    setError("");
    setShowForm(true);
  }, []);

  const openEdit = useCallback((m: RecoveryMovement) => {
    setForm({
      canonicalName: m.canonicalName,
      category: m.category,
      bodyRegion: m.bodyRegion ?? [],
      description: m.description ?? "",
      isPerSide: m.isPerSide,
      prescription: m.defaultPrescription ?? {},
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

  const toggleRegion = useCallback((r: RecoveryBodyRegion) => {
    setForm((prev) => ({
      ...prev,
      bodyRegion: prev.bodyRegion.includes(r)
        ? prev.bodyRegion.filter((x) => x !== r)
        : [...prev.bodyRegion, r],
    }));
  }, []);

  const setRx = useCallback(
    (key: keyof RecoveryPrescription, raw: string) => {
      setForm((prev) => {
        const next = { ...prev.prescription };
        if (raw === "") {
          delete next[key];
        } else if (key === "tempo" || key === "cadence" || key === "load") {
          (next as Record<string, string>)[key] = raw;
        } else {
          const n = Number(raw);
          if (Number.isFinite(n)) (next as Record<string, number>)[key] = n;
        }
        return { ...prev, prescription: next };
      });
    },
    []
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");
      const trimmedDescription = form.description.trim();
      const defaultPrescription = form.prescription as Record<string, unknown>;
      try {
        if (editingId) {
          await updateMutation.mutateAsync({
            id: editingId,
            canonicalName: form.canonicalName.trim(),
            category: form.category,
            bodyRegion: form.bodyRegion,
            description: trimmedDescription || null,
            isPerSide: form.isPerSide,
            defaultPrescription,
          });
        } else {
          await createMutation.mutateAsync({
            canonicalName: form.canonicalName.trim(),
            category: form.category,
            bodyRegion: form.bodyRegion,
            description: trimmedDescription || undefined,
            isPerSide: form.isPerSide,
            defaultPrescription,
          });
        }
        closeForm();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save");
      }
    },
    [editingId, form, createMutation, updateMutation, closeForm]
  );

  return (
    <div className="space-y-4">
      {/* Search + status + add */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search recovery movements..."
              className="pl-9"
            />
          </div>
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as StatusFilter)}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="validated">Validated</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={openCreate} size="sm">
            <Plus className="size-4" />
            Add
          </Button>
        </div>
        <CategoryPills
          value={category}
          onChange={setCategory}
          options={RECOVERY_CATEGORY_FILTER_OPTIONS}
        />
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground mb-2">
            {filtered.length} movements
          </p>
          {filtered.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium truncate">
                    {m.canonicalName}
                  </span>
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {m.category}
                  </Badge>
                  {!m.isValidated && (
                    <Badge
                      variant="outline"
                      className="text-[10px] gap-1 border-amber-500/40 text-amber-300"
                    >
                      <ShieldAlert className="size-3" />
                      Pending
                    </Badge>
                  )}
                  {(m.videoCount ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                      <Video className="size-3" />
                      {m.videoCount}
                    </span>
                  )}
                </div>
                {m.bodyRegion && m.bodyRegion.length > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {m.bodyRegion.map(formatLabel).join(", ")}
                  </p>
                )}
              </div>
              {!m.isValidated && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-emerald-400 hover:text-emerald-300"
                  title="Validate"
                  disabled={validateMutation.isPending}
                  onClick={() => validateMutation.mutate(m.id)}
                >
                  <CheckCircle2 className="size-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => openEdit(m)}
                title="Edit"
              >
                <Pencil className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-destructive hover:text-destructive"
                title="Delete"
                onClick={() => {
                  if (confirm(`Delete "${m.canonicalName}"?`)) {
                    deleteMutation.mutate(m.id, {
                      onError: (err) => alert(err.message),
                    });
                  }
                }}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Create / edit dialog */}
      <Dialog
        open={showForm}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
      >
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit Recovery Movement" : "Add Recovery Movement"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="arm-name">Name</Label>
              <Input
                id="arm-name"
                value={form.canonicalName}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    canonicalName: e.target.value,
                  }))
                }
                placeholder="e.g. Pigeon Stretch"
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
                    category: val as RecoveryCategory,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECOVERY_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {formatLabel(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Body region</Label>
              <div className="flex flex-wrap gap-1">
                {RECOVERY_BODY_REGIONS.map((r) => {
                  const selected = form.bodyRegion.includes(r);
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => toggleRegion(r)}
                      className={`rounded-md px-2 py-1 text-xs font-medium ${
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/50 text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {formatLabel(r)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="arm-desc">Description</Label>
              <Textarea
                id="arm-desc"
                value={form.description}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                placeholder="Optional cues or notes"
                rows={3}
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="arm-perside"
                checked={form.isPerSide}
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, isPerSide: checked }))
                }
              />
              <Label htmlFor="arm-perside" className="text-sm">
                Per side
              </Label>
            </div>

            <div className="space-y-2">
              <Label>Default prescription</Label>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground/80">
                    Sets
                  </Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={form.prescription.sets ?? ""}
                    onChange={(e) => setRx("sets", e.target.value)}
                    placeholder="3"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground/80">
                    Reps
                  </Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={form.prescription.reps ?? ""}
                    onChange={(e) => setRx("reps", e.target.value)}
                    placeholder="10"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground/80">
                    Hold (s)
                  </Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={form.prescription.durationSeconds ?? ""}
                    onChange={(e) => setRx("durationSeconds", e.target.value)}
                    placeholder="30"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Videos section — only when editing an existing movement */}
            {editingId && <VideosSection movementId={editingId} />}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex gap-2">
              <Button
                type="submit"
                className="flex-1"
                disabled={
                  createMutation.isPending || updateMutation.isPending
                }
              >
                {createMutation.isPending || updateMutation.isPending
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

// ---------------------------------------------------------------------------
// Videos section
//
// Shown inside the edit dialog. Lists existing videos with editable label and
// delete button. Adding new videos goes through the existing user-facing
// detail page (which already has the upload + external-URL flows).
// ---------------------------------------------------------------------------

function VideosSection({ movementId }: { movementId: string }) {
  const { data: videos, isLoading } = useRecoveryMovementVideos(movementId);

  return (
    <div className="space-y-2 rounded-lg border border-border/50 bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs uppercase tracking-wide">
          Videos ({videos?.length ?? 0})
        </Label>
        <Link
          href={`/recovery/movements/${movementId}`}
          target="_blank"
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          Add new
          <ExternalLink className="size-3" />
        </Link>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-2">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : !videos || videos.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No videos yet.</p>
      ) : (
        <div className="space-y-1">
          {videos.map((v) => (
            <VideoRow key={v.id} movementId={movementId} video={v} />
          ))}
        </div>
      )}
    </div>
  );
}

function VideoRow({
  movementId,
  video,
}: {
  movementId: string;
  video: RecoveryVideo;
}) {
  const [editing, setEditing] = useState(false);
  const [labelDraft, setLabelDraft] = useState(video.label ?? "");
  const updateMutation = useUpdateRecoveryVideo();
  const deleteMutation = useDeleteRecoveryVideo();

  const save = () => {
    updateMutation.mutate(
      {
        movementId,
        videoId: video.id,
        label: labelDraft.trim() || null,
      },
      {
        onSuccess: () => setEditing(false),
        onError: (err) => alert(err.message),
      }
    );
  };

  const cancel = () => {
    setLabelDraft(video.label ?? "");
    setEditing(false);
  };

  return (
    <div className="flex items-center gap-2 rounded-md border border-border/40 bg-background/40 px-2 py-1.5">
      <div className="flex-1 min-w-0 space-y-0.5">
        {editing ? (
          <Input
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            placeholder="Label (optional)"
            className="h-7 text-xs"
            autoFocus
          />
        ) : (
          <p className="text-xs truncate">
            {video.label || (
              <span className="text-muted-foreground italic">
                Untitled video
              </span>
            )}
          </p>
        )}
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Badge variant="outline" className="text-[9px] capitalize">
            {video.sourceType}
          </Badge>
          <Badge variant="outline" className="text-[9px] capitalize">
            {video.visibility}
          </Badge>
          {video.durationSeconds != null && (
            <span>{video.durationSeconds}s</span>
          )}
        </div>
      </div>
      {editing ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={save}
            disabled={updateMutation.isPending}
            title="Save"
          >
            <Save className="size-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={cancel}
            title="Cancel"
          >
            <X className="size-3" />
          </Button>
        </>
      ) : (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => setEditing(true)}
            title="Edit label"
          >
            <Pencil className="size-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-destructive hover:text-destructive"
            title="Delete video"
            onClick={() => {
              if (confirm("Delete this video?")) {
                deleteMutation.mutate(
                  { movementId, videoId: video.id },
                  { onError: (err) => alert(err.message) }
                );
              }
            }}
          >
            <Trash2 className="size-3" />
          </Button>
        </>
      )}
    </div>
  );
}
