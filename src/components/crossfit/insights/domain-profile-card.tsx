"use client";

import { useState } from "react";
import {
  Compass,
  Dumbbell,
  Activity,
  Heart,
  Layers,
  Loader2,
  ArrowUp,
  ArrowDown,
  Minus,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useDomainProfile } from "@/hooks/useCrossfitInsights";
import type {
  DomainKey,
  DomainMetrics,
  DomainProfile,
  ProgressionDirection,
  ProgressionMetric,
} from "@/lib/crossfit/insights/domain-profile";

type View = "self" | "past";

const DOMAIN_LABEL: Record<DomainKey, string> = {
  weightlifting: "Weightlifting",
  gymnastics: "Gymnastics",
  monostructural: "Monostructural",
  mixed: "Mixed",
};

const DOMAIN_ICON: Record<DomainKey, typeof Dumbbell> = {
  weightlifting: Dumbbell,
  gymnastics: Activity,
  monostructural: Heart,
  mixed: Layers,
};

export function DomainProfileCard() {
  const { data, isLoading, isError } = useDomainProfile();
  const [view, setView] = useState<View>("self");

  return (
    <Card className="gradient-border">
      <CardContent className="p-4 md:p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10">
            <Compass className="h-5 w-5 text-blue-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Where you&apos;re strong, where you&apos;re weak</p>
            <p className="text-xs text-muted-foreground">
              90-day balance across the four CrossFit domains.
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
            Couldn&apos;t load domain profile. Try again later.
          </div>
        )}

        {data && <Body profile={data} view={view} setView={setView} />}
      </CardContent>
    </Card>
  );
}

function Body({
  profile,
  view,
  setView,
}: {
  profile: DomainProfile;
  view: View;
  setView: (v: View) => void;
}) {
  if (!profile.hasEnoughData) {
    return (
      <div className="rounded-md border border-dashed border-white/[0.06] py-5 px-3 text-center">
        <p className="text-sm font-medium">Keep logging</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Log 8+ weeks of workouts to see how your training is balanced.
        </p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {profile.totalDistinctWorkouts} workout
          {profile.totalDistinctWorkouts === 1 ? "" : "s"} logged so far ·{" "}
          {profile.scoringSpanDays} day
          {profile.scoringSpanDays === 1 ? "" : "s"} of history
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <ViewToggle view={view} onChange={setView} />
      </div>

      {view === "self" ? (
        <SelfBalanceView profile={profile} />
      ) : (
        <VsPastView profile={profile} />
      )}
    </div>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: View;
  onChange: (v: View) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border/60 bg-muted/30 p-0.5 text-[11px]">
      <ToggleButton active={view === "self"} onClick={() => onChange("self")}>
        Self-balance
      </ToggleButton>
      <ToggleButton active={view === "past"} onClick={() => onChange("past")}>
        Vs. past
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded px-2 py-1 transition-colors " +
        (active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground")
      }
    >
      {children}
    </button>
  );
}

// ============================================
// Self-balance view
// ============================================

function SelfBalanceView({ profile }: { profile: DomainProfile }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {profile.domains.map((d) => (
        <DomainQuadrant
          key={d.domain}
          domain={d}
          isStrong={profile.strongDomain === d.domain}
          isWeak={profile.weakDomain === d.domain}
        />
      ))}
    </div>
  );
}

function DomainQuadrant({
  domain,
  isStrong,
  isWeak,
}: {
  domain: DomainMetrics;
  isStrong: boolean;
  isWeak: boolean;
}) {
  const Icon = DOMAIN_ICON[domain.domain];
  const scalingPct = Math.round(domain.scalingRate * 100);
  const emphasisPct = Math.round(domain.relativeEmphasis * 100);

  const borderClass = isStrong
    ? "border-emerald-500/60"
    : isWeak
      ? "border-orange-500/60"
      : "border-border/50";

  const tag = isStrong ? "Strongest" : isWeak ? "Weakest" : null;
  const tagClass = isStrong
    ? "text-emerald-400 bg-emerald-500/10"
    : "text-orange-400 bg-orange-500/10";

  return (
    <div
      className={`rounded-lg border ${borderClass} bg-muted/20 p-3 flex flex-col gap-2`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="font-medium text-xs truncate">
            {DOMAIN_LABEL[domain.domain]}
          </p>
        </div>
        {tag && (
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${tagClass}`}>
            {tag}
          </span>
        )}
      </div>

      <div className="space-y-0.5">
        <div className="flex items-baseline justify-between text-[11px]">
          <span className="text-muted-foreground">Workouts</span>
          <span className="font-mono">{domain.volumeScore}</span>
        </div>
        <div className="flex items-baseline justify-between text-[11px]">
          <span className="text-muted-foreground">Emphasis</span>
          <span className="font-mono">{emphasisPct}%</span>
        </div>
        {domain.movementInstances > 0 ? (
          <div className="flex items-baseline justify-between text-[11px]">
            <span className="text-muted-foreground">Scaled</span>
            <span className="font-mono">{scalingPct}%</span>
          </div>
        ) : (
          <div className="text-[11px] text-muted-foreground italic">
            No movements logged
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Vs. past view
// ============================================

function VsPastView({ profile }: { profile: DomainProfile }) {
  return (
    <div className="space-y-2">
      {profile.domains.map((d) => (
        <DomainPastRow key={d.domain} domain={d} />
      ))}
      <p className="pt-1 text-[10px] text-muted-foreground">
        Compared to the prior {profile.windowDays} days.
      </p>
    </div>
  );
}

function DomainPastRow({ domain }: { domain: DomainMetrics }) {
  const Icon = DOMAIN_ICON[domain.domain];
  const hasAny = domain.movementInstances + domain.priorMovementInstances > 0;

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="font-medium text-sm">{DOMAIN_LABEL[domain.domain]}</p>
      </div>

      {!hasAny ? (
        <p className="text-[11px] text-muted-foreground italic">
          No movements logged in this domain.
        </p>
      ) : (
        <div className="space-y-1.5">
          {domain.progression.map((m) => (
            <ProgressionRow key={m.metric} metric={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProgressionRow({ metric }: { metric: ProgressionMetric }) {
  const arrow = arrowFor(metric.direction);
  const colorClass = colorFor(metric.direction);

  return (
    <div className="flex items-baseline justify-between gap-2 text-[11px]">
      <span className="text-muted-foreground">{metric.label}</span>
      <span className="flex items-center gap-1 font-mono">
        <span className="text-muted-foreground">
          {formatMetricValue(metric.metric, metric.prior)}
        </span>
        <span className="text-muted-foreground">→</span>
        <span>{formatMetricValue(metric.metric, metric.current)}</span>
        <span className={`flex items-center gap-0.5 ml-1 font-medium ${colorClass}`}>
          {arrow}
          {Math.round(metric.magnitudePct)}%
        </span>
      </span>
    </div>
  );
}

function arrowFor(direction: ProgressionDirection) {
  if (direction === "up") return <ArrowUp className="h-3 w-3" />;
  if (direction === "down") return <ArrowDown className="h-3 w-3" />;
  return <Minus className="h-3 w-3" />;
}

function colorFor(direction: ProgressionDirection): string {
  if (direction === "up") return "text-emerald-400";
  if (direction === "down") return "text-orange-400";
  return "text-muted-foreground";
}

function formatMetricValue(
  metric: ProgressionMetric["metric"],
  value: number | null
): string {
  if (value == null) return "—";
  if (metric === "scaling_rate") return `${Math.round(value * 100)}%`;
  if (metric === "avg_e1rm") return `${Math.round(value)} lb`;
  return `${value}`;
}
