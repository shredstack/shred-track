"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  ClipboardList,
  ClipboardPaste,
  FileText,
  Loader2,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WORKOUT_SECTION_KIND_LABELS, type WorkoutSectionKind } from "@/db/schema";
import { ProgrammingDayCard } from "./programming-day-card";
import { ProgrammingWeekHeader } from "./programming-week-header";
import { CapPasteDialog } from "./cap-paste-dialog";
import { GymToolHeader } from "@/components/gym/gym-tool-header";

// Per-movement wire shape. Carries enough prescription data for the inline
// admin preview to render the same content the athlete will see (without a
// separate per-workout round trip). Everything is the raw DB shape — the
// preview component formats it via lib/crossfit/prescription.
interface MovementWire {
  id: string;
  movementName: string;
  metricType: string;
  orderIndex: number;
  workoutBlockId: string | null;
  prescribedReps: string | null;
  prescribedWeightMale: string | null;
  prescribedWeightFemale: string | null;
  prescribedCaloriesMale: string | null;
  prescribedCaloriesFemale: string | null;
  prescribedDistanceMale: string | null;
  prescribedDistanceFemale: string | null;
  prescribedDurationSecondsMale: number | null;
  prescribedDurationSecondsFemale: number | null;
  prescribedHeightInches: string | null;
  prescribedHeightInchesMale: string | null;
  prescribedHeightInchesFemale: string | null;
  prescribedWeightMaleBwMultiplier: string | null;
  prescribedWeightFemaleBwMultiplier: string | null;
  prescribedWeightPct: string | null;
  tempo: string | null;
  isMaxReps: boolean;
  captureDurationPerRound: boolean;
  isSideCadence: boolean;
  equipmentCount: number | null;
}

interface PartWire {
  id: string;
  label: string | null;
  orderIndex: number;
  notes: string | null;
  workoutType: string;
  timeCapSeconds: number | null;
  amrapDurationSeconds: number | null;
  emomIntervalSeconds: number | null;
  intervalWorkSeconds: number | null;
  intervalRestSeconds: number | null;
  intervalRounds: unknown;
  sideCadenceIntervalSeconds: number | null;
  sideCadenceOpenEnded: boolean;
  repScheme: string | null;
  rounds: number | null;
  structure: string | null;
  blocks: { id: string; orderIndex: number; title: string }[];
  movements: MovementWire[];
}

interface SectionWire {
  id: string;
  kind: WorkoutSectionKind;
  subKind: string | null;
  position: number;
  title: string | null;
  body: string | null;
  isScored: boolean;
  scoreType: string | null;
  reviewedAt: string | null;
  sourceTrackId: string | null;
  parts: PartWire[];
}

interface WorkoutWire {
  id: string;
  title: string | null;
  description: string | null;
  workoutDate: string;
  workoutType: string;
  programmingReleaseId: string | null;
  reviewedAt: string | null;
  sections: SectionWire[];
  partsWithoutSection: PartWire[];
}

interface WeekData {
  weekStart: string;
  release: {
    id: string;
    status: "draft" | "published";
    publishedAt: string | null;
    source: string;
  } | null;
  workouts: WorkoutWire[];
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface Props {
  communityId: string;
  gymName: string;
  gymTimezone: string;
  weekStart: string;
  capPasteEnabled: boolean;
}

export function ProgrammingWeekView({
  communityId,
  gymName,
  gymTimezone,
  weekStart,
  capPasteEnabled,
}: Props) {
  const qc = useQueryClient();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { data, isLoading } = useQuery<WeekData>({
    queryKey: ["gym", communityId, "programming", weekStart],
    queryFn: async () => {
      const res = await fetch(
        `/api/gym/${communityId}/programming?weekStart=${weekStart}`
      );
      if (!res.ok) throw new Error("Failed to load programming");
      return res.json();
    },
  });

  // Programmed workouts (tied to this release) live in one bucket;
  // manual workouts (added from the CrossFit tab, no
  // programming_release_id) live in another. Showing them separately in
  // the day card lets the coach see both without one silently shadowing
  // the other in a Map lookup.
  const days = useMemo(() => {
    const programmed = new Map<string, WorkoutWire>();
    const manual = new Map<string, WorkoutWire[]>();
    for (const w of data?.workouts ?? []) {
      if (w.programmingReleaseId) {
        programmed.set(w.workoutDate, w);
      } else {
        const list = manual.get(w.workoutDate) ?? [];
        list.push(w);
        manual.set(w.workoutDate, list);
      }
    }
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(weekStart, i);
      return {
        date,
        workout: programmed.get(date) ?? null,
        manualWorkouts: manual.get(date) ?? [],
      };
    });
  }, [data, weekStart]);

  const onSectionMutate = useCallback(() => {
    qc.invalidateQueries({
      queryKey: ["gym", communityId, "programming", weekStart],
    });
    // Also refresh the nav strip — creating or deleting a release flips
    // the current week's status and changes the next-empty-week pointers.
    qc.invalidateQueries({
      queryKey: ["gym", communityId, "programming-nav", weekStart],
    });
  }, [qc, communityId, weekStart]);

  async function publish() {
    if (!data?.release) {
      toast.error("Save a draft first (paste a CAP week or add a section).");
      return;
    }
    setPublishing(true);
    try {
      const res = await fetch(
        `/api/gym/${communityId}/programming/${data.release.id}/publish`,
        { method: "POST" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to publish");
      }
      toast.success("Published. Members can see this week.");
      onSectionMutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setPublishing(false);
    }
  }

  async function unpublish() {
    if (!data?.release) return;
    if (
      !confirm(
        "Unpublish this week? Members will stop seeing it, but the workouts and sections stay so you can edit and republish."
      )
    ) {
      return;
    }
    setUnpublishing(true);
    try {
      const res = await fetch(
        `/api/gym/${communityId}/programming/${data.release.id}/unpublish`,
        { method: "POST" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to unpublish");
      }
      toast.success("Unpublished. Members no longer see this week.");
      onSectionMutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setUnpublishing(false);
    }
  }

  async function deleteRelease() {
    if (!data?.release) return;
    if (
      !confirm(
        "Delete this entire week's programming? Manual workouts added from the CrossFit tab will be kept. This cannot be undone."
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/gym/${communityId}/programming/${data.release.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to delete");
      }
      toast.success("Programming for this week was deleted.");
      onSectionMutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setDeleting(false);
    }
  }

  // Map the loaded release to the simpler `WeekStatus` tri-state the
  // new week header understands. Treat the absence of a release row as
  // "empty" — the coach hasn't touched this week yet.
  const currentStatus: "published" | "draft" | "empty" = data?.release
    ? data.release.status === "published"
      ? "published"
      : "draft"
    : "empty";

  return (
    <div className="space-y-3">
      <GymToolHeader
        icon={ClipboardList}
        label="Programming"
        description={gymName}
      />

      <ProgrammingWeekHeader
        communityId={communityId}
        gymTimezone={gymTimezone}
        weekStart={weekStart}
        currentStatus={currentStatus}
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <FileText className="h-4 w-4" />
            Release
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data?.release?.status === "published" && (
            <div className="flex items-center gap-1 text-xs text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Published — members can see this week.
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {capPasteEnabled ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPasteOpen(true)}
              >
                <ClipboardPaste className="mr-1.5 h-3.5 w-3.5" />
                Paste CAP week
              </Button>
            ) : null}
            {data?.release?.status === "published" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={unpublish}
                disabled={unpublishing}
                title="Hide this week from members. Workouts and sections are kept so you can edit and republish."
              >
                {unpublishing ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                )}
                Unpublish
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={publish}
                disabled={publishing || !data?.release}
              >
                {publishing ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                )}
                Publish week
              </Button>
            )}
            {data?.release ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={deleteRelease}
                disabled={deleting}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                title="Delete this week's programming. Manual workouts from the CrossFit tab are kept."
              >
                {deleting ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                Delete week
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-3">
          {days.map((d) => (
            <ProgrammingDayCard
              key={d.date}
              communityId={communityId}
              date={d.date}
              workout={d.workout}
              manualWorkouts={d.manualWorkouts}
              onMutated={onSectionMutate}
            />
          ))}
        </div>
      )}

      <CapPasteDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        communityId={communityId}
        weekStart={weekStart}
        onSaved={() => {
          setPasteOpen(false);
          onSectionMutate();
        }}
      />

      <KindLegend />
    </div>
  );
}

function KindLegend() {
  const entries = Object.entries(WORKOUT_SECTION_KIND_LABELS);
  return (
    <details className="rounded-md border border-border/60 bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none font-medium">
        Section kinds
      </summary>
      <ul className="mt-1.5 grid grid-cols-2 gap-1">
        {entries.map(([k, label]) => (
          <li key={k} className="flex items-center gap-1.5">
            <Plus className="h-2.5 w-2.5 text-muted-foreground/60" />
            {label} <code className="text-[10px]">({k})</code>
          </li>
        ))}
      </ul>
    </details>
  );
}
