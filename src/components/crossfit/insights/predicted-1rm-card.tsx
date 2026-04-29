"use client";

import { useState } from "react";
import Link from "next/link";
import { Dumbbell, Loader2, ChevronDown, ChevronUp, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useOneRmPredictions } from "@/hooks/useCrossfitInsights";
import type {
  Predicted1RM,
  StaleLift,
} from "@/lib/crossfit/insights/predicted-1rm";

function formatMonths(months: number | null): string {
  if (months == null) return "never tested";
  const rounded = Math.round(months);
  if (rounded < 1) return "<1 mo ago";
  if (rounded === 1) return "1 mo ago";
  if (rounded < 12) return `${rounded} mo ago`;
  const years = Math.floor(rounded / 12);
  const rem = rounded % 12;
  if (rem === 0) return `${years} yr ago`;
  return `${years} yr ${rem} mo ago`;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}

export function Predicted1RMCard() {
  const { data, isLoading, isError } = useOneRmPredictions();

  return (
    <Card className="gradient-border">
      <CardContent className="p-4 md:p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10">
            <Dumbbell className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <p className="font-semibold">Predicted 1RMs</p>
            <p className="text-xs text-muted-foreground">
              For lifts you haven&apos;t tested in over a year.
            </p>
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {isError && (
          <ErrorRow message="Couldn't load 1RM predictions. Try again later." />
        )}

        {data && <PredictionList result={data} />}
      </CardContent>
    </Card>
  );
}

function PredictionList({
  result,
}: {
  result: { predictions: Predicted1RM[]; staleLifts: StaleLift[] };
}) {
  const { predictions, staleLifts } = result;

  if (predictions.length === 0 && staleLifts.length === 0) {
    return (
      <EmptyState
        title="Log a heavy weightlifting session"
        body="Once you've logged a couple of barbell sessions, we'll predict your 1RMs from the data."
        cta={{ href: "/crossfit", label: "Add a workout" }}
      />
    );
  }

  return (
    <div className="space-y-2">
      {predictions.length > 0 ? (
        predictions.map((p) => <PredictionRow key={p.movementId} p={p} />)
      ) : (
        <p className="rounded-md border border-dashed border-white/[0.06] py-3 px-3 text-xs text-muted-foreground">
          All your tested lifts are still fresh — nice. We&apos;ll surface
          predictions here once one hits the 12-month mark.
        </p>
      )}

      {staleLifts.length > 0 && <StaleLiftsList items={staleLifts} />}
    </div>
  );
}

function PredictionRow({ p }: { p: Predicted1RM }) {
  const [expanded, setExpanded] = useState(false);
  const band = p.confidenceBandPct;
  const lo = Math.round(p.estimatedOneRm * (1 - band / 100));
  const hi = Math.round(p.estimatedOneRm * (1 + band / 100));

  const delta = p.lastDirectTest
    ? p.estimatedOneRm - p.lastDirectTest.weight
    : null;

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{p.movementName}</span>
            <Badge
              variant="outline"
              className="text-[10px] text-muted-foreground"
            >
              ±{band}%
            </Badge>
          </div>
          <div className="mt-1 flex items-baseline gap-2 flex-wrap">
            <span className="font-mono text-lg font-semibold">
              {p.estimatedOneRm}
              <span className="text-xs text-muted-foreground"> lb</span>
            </span>
            <span className="text-[11px] text-muted-foreground">
              ({lo}–{hi})
            </span>
          </div>

          {p.lastDirectTest ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Last tested: {p.lastDirectTest.weight} lb ·{" "}
              {formatMonths(p.monthsSinceLastTest)}
              {delta != null && (
                <span
                  className={
                    delta > 0
                      ? " text-emerald-400 font-medium ml-1"
                      : delta < 0
                        ? " text-orange-400 font-medium ml-1"
                        : " text-muted-foreground ml-1"
                  }
                >
                  {delta > 0 ? "↑" : delta < 0 ? "↓" : "→"}{" "}
                  {delta > 0 ? "+" : ""}
                  {delta} lb
                </span>
              )}
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Never directly tested · based on {p.qualifyingSetsCount}{" "}
              recent set{p.qualifyingSetsCount === 1 ? "" : "s"}
            </p>
          )}
        </div>

        <Link href="/crossfit" className="shrink-0">
          <Button size="sm" variant="outline" className="h-8 gap-1">
            <Plus className="h-3 w-3" />
            Test it
          </Button>
        </Link>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
        {expanded ? "Hide" : "Show"} {p.contributingSets.length} contributing
        set{p.contributingSets.length === 1 ? "" : "s"}
      </button>

      {expanded && (
        <div className="mt-2 space-y-1">
          {p.contributingSets.map((s, i) => (
            <div
              key={i}
              className="flex items-center justify-between text-[11px] font-mono px-2 py-1 rounded bg-muted/30"
            >
              <span>
                {s.weight} lb × {s.reps}
                {s.rpe != null && (
                  <span className="text-muted-foreground"> @{s.rpe}</span>
                )}
              </span>
              <span className="text-muted-foreground">
                {formatDate(s.loggedAt)}
              </span>
              <span className="text-emerald-400">
                e1RM ~{Math.round(s.estimatedOneRm)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StaleLiftsList({ items }: { items: StaleLift[] }) {
  return (
    <div className="rounded-md border border-dashed border-white/[0.08] bg-muted/10 p-3">
      <p className="text-xs font-medium">Untracked lifts</p>
      <p className="text-[11px] text-muted-foreground mb-2">
        Not enough recent data to predict — log a session and we&apos;ll start
        estimating.
      </p>
      <div className="space-y-1">
        {items.map((s) => (
          <div
            key={s.movementId}
            className="flex items-center justify-between text-[11px]"
          >
            <span className="font-medium">{s.movementName}</span>
            <span className="text-muted-foreground">
              {s.lastDirectTest
                ? `last tested ${formatMonths(s.monthsSinceLastTest)}`
                : s.monthsSinceAnyLog != null
                  ? `last logged ${formatMonths(s.monthsSinceAnyLog)}`
                  : "no recent data"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="rounded-md border border-dashed border-white/[0.06] py-5 px-3 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
      {cta && (
        <Link href={cta.href}>
          <Button size="sm" variant="outline" className="mt-3 gap-1">
            <Plus className="h-3 w-3" />
            {cta.label}
          </Button>
        </Link>
      )}
    </div>
  );
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      {message}
    </div>
  );
}
