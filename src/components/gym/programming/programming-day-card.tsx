"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  Trash2,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import {
  WORKOUT_SECTION_KINDS,
  WORKOUT_SECTION_KIND_LABELS,
  WORKOUT_SECTION_SCORE_TYPES,
  type WorkoutSectionKind,
} from "@/db/schema";
import { SmartBuilder } from "@/components/crossfit/smart-builder";
import { builderPartToPayload } from "@/lib/crossfit/builder-payload";
import type { WorkoutBuilderForm } from "@/types/crossfit";

interface SectionWire {
  id: string;
  kind: WorkoutSectionKind;
  position: number;
  title: string | null;
  body?: string | null;
  isScored: boolean;
  scoreType: string | null;
  reviewedAt: string | null;
  parts: { id: string; label: string | null; orderIndex: number; notes: string | null }[];
}

interface WorkoutWire {
  id: string;
  title: string | null;
  workoutDate: string;
  sections: SectionWire[];
  partsWithoutSection: { id: string; label: string | null; orderIndex: number; notes: string | null }[];
}

interface Props {
  communityId: string;
  date: string;
  workout: WorkoutWire | null;
  onMutated: () => void;
}

function formatHeader(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function ProgrammingDayCard({
  communityId,
  date,
  workout,
  onMutated,
}: Props) {
  const [expanded, setExpanded] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newKind, setNewKind] = useState<WorkoutSectionKind>("wod");

  async function addSection() {
    setAdding(true);
    try {
      const res = await fetch(
        `/api/gym/${communityId}/programming/sections`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            workout
              ? { workoutId: workout.id, kind: newKind }
              : { workoutDate: date, kind: newKind }
          ),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to add section");
      }
      toast.success("Section added");
      onMutated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setAdding(false);
    }
  }

  const sortedSections = [...(workout?.sections ?? [])].sort(
    (a, b) => a.position - b.position
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 text-left"
        >
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-sm font-bold">{formatHeader(date)}</span>
          {sortedSections.length === 0 ? (
            <span className="ml-2 text-[10px] text-muted-foreground">
              empty
            </span>
          ) : (
            <span className="ml-2 text-[10px] text-muted-foreground">
              {sortedSections.length} sections
            </span>
          )}
        </button>
      </CardHeader>
      {expanded ? (
        <CardContent className="space-y-2">
          {sortedSections.map((s) => (
            <SectionRow
              key={s.id}
              communityId={communityId}
              section={s}
              onMutated={onMutated}
            />
          ))}
          <div className="flex items-end gap-2 pt-2">
            <div className="flex-1 space-y-1">
              <Label className="text-[10px] text-muted-foreground">
                Add section
              </Label>
              <Select
                value={newKind}
                onValueChange={(v) => setNewKind(v as WorkoutSectionKind)}
              >
                <SelectTrigger className="h-8 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORKOUT_SECTION_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {WORKOUT_SECTION_KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={addSection} disabled={adding}>
              {adding ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Add
            </Button>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}

interface SectionRowProps {
  communityId: string;
  section: SectionWire;
  onMutated: () => void;
}

function SectionRow({ communityId, section, onMutated }: SectionRowProps) {
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<WorkoutSectionKind>(section.kind);
  const [title, setTitle] = useState(section.title ?? "");
  const [bodyText, setBodyText] = useState(section.body ?? "");
  const [isScored, setIsScored] = useState(section.isScored);
  const [scoreType, setScoreType] = useState<string>(
    section.scoreType ?? "no_score"
  );
  const [saving, setSaving] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderSaving, setBuilderSaving] = useState(false);
  const [builderError, setBuilderError] = useState<string | null>(null);

  const handleBuilderSave = useCallback(
    async (form: WorkoutBuilderForm) => {
      setBuilderError(null);
      const parts = form.parts
        .map(builderPartToPayload)
        .filter((p): p is NonNullable<ReturnType<typeof builderPartToPayload>> => p !== null);
      if (parts.length === 0) {
        setBuilderError("Add at least one part with movements.");
        return;
      }
      setBuilderSaving(true);
      try {
        const res = await fetch(
          `/api/gym/${communityId}/programming/sections/${section.id}/content`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ parts }),
          }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? "Failed to save");
        }
        toast.success("Content saved");
        setBuilderOpen(false);
        onMutated();
      } catch (err) {
        setBuilderError(
          err instanceof Error ? err.message : "Failed to save content"
        );
      } finally {
        setBuilderSaving(false);
      }
    },
    [communityId, section.id, onMutated]
  );

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/gym/${communityId}/programming/sections`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: section.id,
            kind,
            title: title || null,
            body: bodyText || null,
            isScored,
            scoreType: isScored ? scoreType : null,
          }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to save");
      }
      toast.success("Saved");
      setEditing(false);
      onMutated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Delete this section? Parts will be moved out of the section.")) return;
    try {
      const res = await fetch(
        `/api/gym/${communityId}/programming/sections?id=${section.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed");
      }
      toast.success("Removed");
      onMutated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  if (!editing) {
    const hasContent =
      section.parts.length > 0 || !!section.body?.trim();
    return (
      <>
        <div className="flex items-start justify-between gap-2 rounded-md border border-border/60 bg-muted/10 px-2.5 py-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
                {WORKOUT_SECTION_KIND_LABELS[section.kind]}
              </span>
              {section.isScored ? (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-400">
                  {section.scoreType?.toUpperCase() ?? "SCORED"}
                </span>
              ) : (
                <span className="rounded bg-muted/30 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                  NO SCORE
                </span>
              )}
              {section.title ? (
                <span className="ml-1 truncate text-xs text-muted-foreground">
                  {section.title}
                </span>
              ) : null}
            </div>
            {section.body?.trim() ? (
              <p className="mt-1.5 whitespace-pre-wrap text-[11px] text-muted-foreground line-clamp-3">
                {section.body}
              </p>
            ) : null}
            <div className="mt-1 text-[11px] text-muted-foreground">
              {section.parts.length === 0 && !section.body?.trim()
                ? "Empty — add content"
                : `${section.parts.length} ${
                    section.parts.length === 1 ? "part" : "parts"
                  }${section.reviewedAt ? " · reviewed" : ""}`}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Button
              size="sm"
              variant={hasContent ? "ghost" : "default"}
              onClick={() => {
                setBuilderError(null);
                setBuilderOpen(true);
              }}
              className="gap-1.5"
              title="Compose movements with the Smart Builder"
            >
              <Wrench className="h-3.5 w-3.5" />
              Build
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={remove}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <Dialog open={builderOpen} onOpenChange={setBuilderOpen}>
          <DialogContent className="max-h-[90vh] w-[min(96vw,42rem)] max-w-none overflow-x-hidden overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                Build {WORKOUT_SECTION_KIND_LABELS[section.kind]} content
              </DialogTitle>
            </DialogHeader>
            {builderError ? (
              <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {builderError}
              </p>
            ) : null}
            {builderSaving ? (
              <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                Saving…
              </div>
            ) : null}
            <SmartBuilder
              onSave={handleBuilderSave}
              onCancel={() => setBuilderOpen(false)}
              saveLabel="Save content"
            />
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-primary/40 bg-primary/[0.04] px-2.5 py-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Kind</Label>
          <Select
            value={kind}
            onValueChange={(v) => setKind(v as WorkoutSectionKind)}
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WORKOUT_SECTION_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {WORKOUT_SECTION_KIND_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Title (optional)</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-8"
            placeholder="Snatch Skill"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">
          Prescription (freeform — for warm-ups, stretching, etc.)
        </Label>
        <Textarea
          rows={3}
          value={bodyText}
          onChange={(e) => setBodyText(e.target.value)}
          placeholder="3 rounds: 10 air squats, 10 push-ups, 200m row"
          className="text-xs"
        />
        <p className="text-[10px] text-muted-foreground">
          Use this for sections that don&apos;t need movement-level scoring.
          For scored WODs and skill work, click <strong>Build</strong> to
          open the Smart Builder.
        </p>
      </div>
      <div className="flex items-center justify-between gap-2 rounded-md bg-background/40 px-2 py-1.5">
        <div>
          <div className="text-xs font-medium">Scored</div>
          <div className="text-[10px] text-muted-foreground">
            Members can log a score on this section.
          </div>
        </div>
        <Switch checked={isScored} onCheckedChange={setIsScored} />
      </div>
      {isScored ? (
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Score type</Label>
          <Select
            value={scoreType}
            onValueChange={(v) => setScoreType(v ?? "no_score")}
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WORKOUT_SECTION_SCORE_TYPES.filter((t) => t !== "no_score").map(
                (t) => (
                  <SelectItem key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="flex justify-end gap-2 pt-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setEditing(false)}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
        </Button>
      </div>
    </div>
  );
}
