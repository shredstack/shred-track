"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

interface SectionWire {
  id: string;
  kind: WorkoutSectionKind;
  position: number;
  title: string | null;
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
    if (!workout) {
      toast.error(
        "No workout exists for this day yet. Paste a CAP week to seed days."
      );
      return;
    }
    setAdding(true);
    try {
      const res = await fetch(
        `/api/gym/${communityId}/programming/sections`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workoutId: workout.id, kind: newKind }),
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
  const [isScored, setIsScored] = useState(section.isScored);
  const [scoreType, setScoreType] = useState<string>(
    section.scoreType ?? "no_score"
  );
  const [saving, setSaving] = useState(false);

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
    return (
      <div className="flex items-start justify-between gap-2 rounded-md border border-border/60 bg-muted/10 px-2.5 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs">
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
          <div className="mt-1 text-[11px] text-muted-foreground">
            {section.parts.length} {section.parts.length === 1 ? "part" : "parts"}
            {section.reviewedAt ? " · reviewed" : ""}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button size="sm" variant="ghost" onClick={remove}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
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
