"use client";

import Link from "next/link";
import { Target, Loader2, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRxGap } from "@/hooks/useCrossfitInsights";
import type { RxGapMovement, RxGapResult } from "@/lib/crossfit/insights/rx-gap";

const TOP_N = 5;

export function RxGapCard() {
  const { data, isLoading, isError } = useRxGap();

  return (
    <Card className="gradient-border">
      <CardContent className="p-4 md:p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500/10">
            <Target className="h-5 w-5 text-orange-400" />
          </div>
          <div>
            <p className="font-semibold">What would unlock more RX</p>
            <p className="text-xs text-muted-foreground">
              The movements holding you back from RX in the last 6 months.
            </p>
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {isError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Couldn&apos;t load RX gap. Try again later.
          </div>
        )}

        {data && <Body result={data} />}
      </CardContent>
    </Card>
  );
}

function Body({ result }: { result: RxGapResult }) {
  const { gaps, totalScoredWorkouts, totalRxWorkouts } = result;

  if (totalScoredWorkouts < 5) {
    return (
      <EmptyState body="Log a few more workouts and we'll spot patterns in what's holding you back." />
    );
  }

  if (gaps.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-emerald-500/30 bg-emerald-500/5 py-5 px-3 text-center">
        <p className="text-sm font-medium">
          You&apos;ve RX&apos;d everything you&apos;ve logged. 🔥
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Time to chase RX+ — or double-check that your scaled scores are
          marked correctly.
        </p>
      </div>
    );
  }

  const top = gaps.slice(0, TOP_N);
  const summary = `You RX'd ${totalRxWorkouts} of the last ${totalScoredWorkouts} workouts.`;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{summary}</p>
      <div className="space-y-2">
        {top.map((g, i) => (
          <GapRow key={g.movementId} gap={g} rank={i + 1} />
        ))}
      </div>
    </div>
  );
}

function GapRow({ gap, rank }: { gap: RxGapMovement; rank: number }) {
  const pct = Math.round(gap.scalingRate * 100);
  const sole = gap.soleBlockerUnlocks;
  const partial = gap.partialBlockerAppearances;

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
      <div className="flex items-start gap-3">
        <span className="font-mono text-xs text-muted-foreground pt-0.5">
          {rank}.
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm">{gap.movementName}</p>

          {sole > 0 ? (
            <p className="mt-1 text-xs text-foreground">
              Would have unlocked{" "}
              <span className="text-emerald-400 font-semibold">
                {sole} RX workout{sole === 1 ? "" : "s"}
              </span>{" "}
              if mastered.
            </p>
          ) : partial > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Held you back in {partial} workout{partial === 1 ? "" : "s"}{" "}
              with multiple scaled movements.
            </p>
          ) : null}

          <p className="mt-1 text-[11px] text-muted-foreground">
            You scaled {gap.scaledInstances} of {gap.totalInstances}{" "}
            {gap.totalInstances === 1 ? "appearance" : "appearances"} ({pct}%)
            {sole > 0 && partial > 0 && (
              <span className="ml-1">· also a partial blocker in {partial}</span>
            )}
          </p>

          {gap.rxStandardSummary && (
            <Badge
              variant="outline"
              className="mt-2 text-[10px] text-muted-foreground font-normal"
            >
              RX: {gap.rxStandardSummary}
            </Badge>
          )}
          {gap.topModification && (
            <p className="mt-1 text-[10px] italic text-muted-foreground line-clamp-1">
              Most common scale: {gap.topModification}
            </p>
          )}
        </div>

        <Link href={`/crossfit/movements/${gap.movementId}`} className="shrink-0">
          <Button size="sm" variant="outline" className="h-8 gap-1">
            Drills
            <ArrowRight className="h-3 w-3" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

function EmptyState({ body }: { body: string }) {
  return (
    <div className="rounded-md border border-dashed border-white/[0.06] py-5 px-3 text-center">
      <p className="text-xs text-muted-foreground">{body}</p>
    </div>
  );
}
