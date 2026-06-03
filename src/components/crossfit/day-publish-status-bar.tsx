"use client";

// ---------------------------------------------------------------------------
// DayPublishStatusBar — the "Draft" / "Published" pill + publish CTA.
//
// Single component used in two places: the week editor (above the day stack)
// and the CrossFit-tab admin view (above the selected day's card). Same
// publish/unpublish endpoints, same React Query invalidation, so toggling
// state on one surface is reflected on the other on the next read.
//
// The bar is week-scoped because `programmingReleases` is week-scoped. A
// coach who wants to know "will today be visible to my members?" gets the
// answer here, even though the publish lever moves the whole containing
// week. See spec §5.2 for the rationale on not introducing day-level
// publish.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Circle, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { gymProgrammingWeekKey } from "@/hooks/useGymProgrammingWeek";
import type { ProgrammingWeekRelease } from "@/hooks/useGymProgrammingWeek";

interface Props {
  communityId: string;
  release: ProgrammingWeekRelease | null;
  // Workouts-by-date key to invalidate on the CrossFit-tab mount so the
  // admin's own gym-mode view picks up the now-published sessions without
  // a refresh. Omitted from the week-editor mount — there's no athlete-
  // side cache to refresh there.
  onAfterMutate?: () => void;
}

function formatPublishedAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function DayPublishStatusBar({
  communityId,
  release,
  onAfterMutate,
}: Props) {
  const qc = useQueryClient();
  const [publishing, setPublishing] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);

  // Look up the week start from the release row. When the release doesn't
  // exist yet (empty week) we have nothing to invalidate beyond the
  // current-week key — which the parent already holds via its own data
  // fetch, so a coarse `gym/{communityId}` invalidation is fine.
  function invalidate(weekStart: string | undefined) {
    if (weekStart) {
      qc.invalidateQueries({
        queryKey: gymProgrammingWeekKey(communityId, weekStart),
      });
      qc.invalidateQueries({
        queryKey: ["gym", communityId, "programming-nav", weekStart],
      });
    } else {
      qc.invalidateQueries({ queryKey: ["gym", communityId] });
    }
    onAfterMutate?.();
  }

  async function publish() {
    if (!release) return;
    setPublishing(true);
    try {
      const res = await fetch(
        `/api/gym/${communityId}/programming/${release.id}/publish`,
        { method: "POST" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to publish");
      }
      toast.success("Published. Members can see this week.");
      invalidate(undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setPublishing(false);
    }
  }

  async function unpublish() {
    if (!release) return;
    if (
      !confirm(
        "Members will no longer see this week's programming. Continue?"
      )
    ) {
      return;
    }
    setUnpublishing(true);
    try {
      const res = await fetch(
        `/api/gym/${communityId}/programming/${release.id}/unpublish`,
        { method: "POST" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to unpublish");
      }
      toast.success("Unpublished. Members no longer see this week.");
      invalidate(undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setUnpublishing(false);
    }
  }

  // Three states: no release row, draft, published. Each renders the same
  // pill + (optionally) CTA shape so coaches can scan it in a glance and
  // know whether their members will see today.
  if (!release) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/10 px-2.5 py-2 text-[11px] text-muted-foreground">
        <Circle className="h-2 w-2 fill-muted-foreground/40 stroke-muted-foreground/40" />
        <span className="flex-1">No programming yet for this week</span>
      </div>
    );
  }

  if (release.status === "published") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 px-2.5 py-2 text-[11px] text-emerald-300">
        <Circle className="h-2 w-2 fill-emerald-400 stroke-emerald-400" />
        <span className="flex-1">
          Published
          {release.publishedAt
            ? ` ${formatPublishedAt(release.publishedAt)}`
            : ""}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={unpublish}
          disabled={unpublishing}
          title="Hide this week from members. Workouts and sections are kept."
          className="h-7 gap-1.5 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200"
        >
          {unpublishing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RotateCcw className="h-3 w-3" />
          )}
          Unpublish
        </Button>
      </div>
    );
  }

  // Draft
  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-2 text-[11px] text-amber-300">
      <Circle className="h-2 w-2 fill-amber-400 stroke-amber-400" />
      <div className="flex flex-1 flex-col">
        <span>Draft — not visible to members yet</span>
        <span className="text-[10px] text-amber-300/70">
          Members will be notified.
        </span>
      </div>
      <Button
        size="sm"
        onClick={publish}
        disabled={publishing}
        className="h-7 gap-1.5"
      >
        {publishing ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Sparkles className="h-3 w-3" />
        )}
        Publish week
      </Button>
    </div>
  );
}
