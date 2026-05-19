"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  ClipboardPaste,
  FileText,
  Loader2,
  Plus,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WORKOUT_SECTION_KIND_LABELS, type WorkoutSectionKind } from "@/db/schema";
import { ProgrammingDayCard } from "./programming-day-card";
import { CapPasteDialog } from "./cap-paste-dialog";
import { GymToolHeader } from "@/components/gym/gym-tool-header";

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
  parts: { id: string; label: string | null; orderIndex: number; notes: string | null }[];
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
  partsWithoutSection: { id: string; label: string | null; orderIndex: number; notes: string | null }[];
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

function formatDayLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
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
  weekStart,
  capPasteEnabled,
}: Props) {
  const qc = useQueryClient();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);

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

  const days = useMemo(() => {
    const map = new Map<string, WorkoutWire>();
    for (const w of data?.workouts ?? []) map.set(w.workoutDate, w);
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(weekStart, i);
      return { date, workout: map.get(date) ?? null };
    });
  }, [data, weekStart]);

  const prevWeek = addDays(weekStart, -7);
  const nextWeek = addDays(weekStart, 7);

  const onSectionMutate = useCallback(() => {
    qc.invalidateQueries({
      queryKey: ["gym", communityId, "programming", weekStart],
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

  return (
    <div className="space-y-3">
      <GymToolHeader
        icon={ClipboardList}
        label="Programming"
        description={`${gymName} — week of ${formatDayLabel(weekStart)}`}
      />
      <div className="flex items-center justify-end gap-1">
        <Link
          href={`/gym/programming/${prevWeek}`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-muted/30"
          aria-label="Previous week"
        >
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <Link
          href={`/gym/programming/${nextWeek}`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-muted/30"
          aria-label="Next week"
        >
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <FileText className="h-4 w-4" />
            Release
          </CardTitle>
          {data?.release ? (
            <span
              className={
                "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase " +
                (data.release.status === "published"
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-amber-500/15 text-amber-400")
              }
            >
              {data.release.status}
            </span>
          ) : (
            <span className="rounded-full bg-muted/30 px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
              Not yet drafted
            </span>
          )}
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
