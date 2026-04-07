"use client";

import {
  Clock,
  Target,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  BarChart3,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  STATION_ORDER,
  CONFIDENCE_LABELS,
  formatTime,
  formatLongTime,
} from "@/lib/hyrox-data";
import type { GeneratedPlan } from "@/lib/plan-generator";

interface DashboardProps {
  plan: GeneratedPlan;
}

function getTrend(confidence: number): { icon: typeof TrendingUp; color: string; label: string } {
  if (confidence >= 4) return { icon: TrendingUp, color: "text-emerald-400", label: "Improving" };
  if (confidence <= 2) return { icon: TrendingDown, color: "text-amber-400", label: "Needs work" };
  return { icon: Minus, color: "text-muted-foreground", label: "Steady" };
}

function computeAdherence(plan: GeneratedPlan): number {
  let total = 0;
  let completed = 0;
  for (const week of plan.weeks) {
    for (const session of week.sessions) {
      if (session.type === "rest") continue;
      total++;
      if (session.status === "completed") completed++;
    }
  }
  return total > 0 ? Math.round((completed / total) * 100) : 0;
}

export function Dashboard({ plan }: DashboardProps) {
  const adherence = computeAdherence(plan);

  const runTime = Math.round(plan.estimatedCurrentTime * 0.5);
  const stationTime = Math.round(plan.estimatedCurrentTime * 0.38);
  const transitionTime = plan.estimatedCurrentTime - runTime - stationTime;

  const goalDiff = plan.estimatedCurrentTime - plan.goalTime;

  const stationData = STATION_ORDER.map((station, i) => {
    const confidence = Math.min(5, Math.max(1, 3 + Math.floor(Math.random() * 0.5)));
    const bestTime = Math.round(plan.estimatedCurrentTime * 0.045 + i * 5);
    return { station, confidence, bestTime };
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Big estimated time - hero card */}
      <Card className="gradient-border overflow-visible">
        <CardContent className="py-8 text-center bg-mesh rounded-xl">
          <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Estimated Race Time
          </p>
          <p className="mt-2 text-5xl font-extrabold font-mono tracking-tight text-gradient-primary">
            {formatLongTime(plan.estimatedCurrentTime)}
          </p>
          <div className="mt-4 flex items-center justify-center gap-2.5">
            <Target className="h-4 w-4 text-emerald-400" />
            <span className="text-sm font-medium text-emerald-400">
              Goal: {formatLongTime(plan.goalTime)}
            </span>
            <Badge variant="secondary" className="text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
              -{formatTime(goalDiff)}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Breakdown */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Running", value: formatTime(runTime), icon: Activity, color: "text-blue-400", bg: "bg-blue-500/10" },
          { label: "Stations", value: formatTime(stationTime), icon: BarChart3, color: "text-orange-400", bg: "bg-orange-500/10" },
          { label: "Transitions", value: formatTime(transitionTime), icon: Clock, color: "text-muted-foreground", bg: "bg-white/[0.04]" },
        ].map((item) => (
          <Card key={item.label} size="sm">
            <CardContent className="flex flex-col items-center gap-1.5 py-3">
              <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${item.bg}`}>
                <item.icon className={`h-3.5 w-3.5 ${item.color}`} />
              </div>
              <span className="font-mono text-sm font-bold">{item.value}</span>
              <span className="text-[10px] text-muted-foreground">{item.label}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Plan adherence */}
      <Card>
        <CardContent className="flex items-center gap-4 py-4">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
            <svg className="h-14 w-14 -rotate-90" viewBox="0 0 56 56">
              <circle
                cx="28"
                cy="28"
                r="24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3.5"
                className="text-white/[0.06]"
              />
              <circle
                cx="28"
                cy="28"
                r="24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3.5"
                strokeDasharray={`${(adherence / 100) * 150.8} 150.8`}
                strokeLinecap="round"
                className="text-primary drop-shadow-[0_0_6px_oklch(0.85_0.20_130_/_40%)]"
              />
            </svg>
            <span className="absolute text-xs font-bold">{adherence}%</span>
          </div>
          <div>
            <p className="font-semibold text-sm">Plan Adherence</p>
            <p className="text-xs text-muted-foreground">
              {adherence >= 80
                ? "Excellent consistency! Keep it up."
                : adherence >= 50
                  ? "Good progress. Try not to miss sessions."
                  : "Stay on track — consistency is key."}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Station progress cards */}
      <div>
        <h3 className="mb-3 text-sm font-bold">Station Progress</h3>
        <div className="grid grid-cols-2 gap-2">
          {stationData.map(({ station, confidence, bestTime }) => {
            const trend = getTrend(confidence);
            const TrendIcon = trend.icon;
            return (
              <Card key={station} size="sm">
                <CardContent className="py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium truncate text-muted-foreground">{station}</span>
                    <TrendIcon className={`h-3.5 w-3.5 ${trend.color}`} />
                  </div>
                  <p className="mt-1.5 font-mono text-lg font-bold">{formatTime(bestTime)}</p>
                  <div className="mt-2 flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <div
                        key={n}
                        className={`h-1 flex-1 rounded-full transition-colors ${
                          n <= confidence
                            ? "bg-primary drop-shadow-[0_0_4px_oklch(0.85_0.20_130_/_30%)]"
                            : "bg-white/[0.06]"
                        }`}
                      />
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {CONFIDENCE_LABELS[confidence]}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Run pace trend */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-500/10">
              <Activity className="h-3.5 w-3.5 text-blue-400" />
            </div>
            Run Pace Trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-1 h-20">
            {[5.5, 5.4, 5.3, 5.2, 5.3, 5.1, 5.0, 4.9, 5.0, 4.8, 4.7, 4.6].map((pace, i) => (
              <div
                key={i}
                className="flex-1 rounded-t bg-blue-500/25 hover:bg-blue-500/40 transition-colors"
                style={{ height: `${((pace - 4) / 2) * 100}%` }}
                title={`Week ${i + 1}: ${Math.floor(pace)}:${String(Math.round((pace % 1) * 60)).padStart(2, "0")} /km`}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
            <span>W1</span>
            <span>W6</span>
            <span>W12</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Average pace trending from 5:30 to 4:36 /km
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
