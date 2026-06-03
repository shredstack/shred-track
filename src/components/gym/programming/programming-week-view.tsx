"use client";

import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ClipboardList,
  ClipboardPaste,
  FileText,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WORKOUT_SECTION_KIND_LABELS } from "@/db/schema";
import { ProgrammingDayCard } from "./programming-day-card";
import { ProgrammingWeekHeader } from "./programming-week-header";
import { CapPasteDialog } from "./cap-paste-dialog";
import { GymToolHeader } from "@/components/gym/gym-tool-header";
import { DayPublishStatusBar } from "@/components/crossfit/day-publish-status-bar";
import {
  gymProgrammingWeekKey,
  useGymProgrammingWeek,
  type ProgrammingWorkoutWire,
} from "@/hooks/useGymProgrammingWeek";

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
  const [deleting, setDeleting] = useState(false);

  const { data, isLoading } = useGymProgrammingWeek(communityId, weekStart);

  // Programmed workouts (tied to this release) live in one bucket;
  // manual workouts (added from the CrossFit tab, no
  // programming_release_id) live in another. Showing them separately in
  // the day card lets the coach see both without one silently shadowing
  // the other in a Map lookup.
  const days = useMemo(() => {
    const programmed = new Map<string, ProgrammingWorkoutWire>();
    const manual = new Map<string, ProgrammingWorkoutWire[]>();
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
      queryKey: gymProgrammingWeekKey(communityId, weekStart),
    });
    // Also refresh the nav strip — creating or deleting a release flips
    // the current week's status and changes the next-empty-week pointers.
    qc.invalidateQueries({
      queryKey: ["gym", communityId, "programming-nav", weekStart],
    });
  }, [qc, communityId, weekStart]);

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

      <DayPublishStatusBar
        communityId={communityId}
        release={data?.release ?? null}
      />

      {(capPasteEnabled || data?.release) ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
              <FileText className="h-4 w-4" />
              Release
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
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
      ) : null}

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
              weekStart={weekStart}
              date={d.date}
              workout={d.workout}
              manualWorkouts={d.manualWorkouts}
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
