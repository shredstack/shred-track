"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Timer, TrendingUp, Target, Zap, Loader2, ChevronDown, ChevronUp, Archive } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useActivePlan, usePlanStatus, usePlanHistory } from "@/hooks/useHyroxPlan";
import { formatLongTime, formatTime } from "@/lib/hyrox-data";

export default function HyroxPage() {
  const router = useRouter();
  const { data: plan, isLoading } = useActivePlan();

  // Poll status if plan is generating
  const isGenerating =
    plan?.generationStatus === "pending" || plan?.generationStatus === "generating";
  const { data: statusData } = usePlanStatus(isGenerating ? plan?.id : null);

  const generationStatus = statusData?.generationStatus ?? plan?.generationStatus;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Plan is generating — show progress
  if (plan && (generationStatus === "pending" || generationStatus === "generating")) {
    return (
      <div className="flex flex-col gap-6">
        <Card className="gradient-border overflow-visible">
          <CardContent className="flex flex-col items-center gap-5 py-10 text-center bg-mesh rounded-xl">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15">
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
            </div>
            <div>
              <p className="text-xl font-bold tracking-tight">
                Generating Your Plan
              </p>
              <p className="mt-2 max-w-xs text-sm text-muted-foreground leading-relaxed">
                Our AI coach is building your personalized HYROX training plan.
                This usually takes 10-20 minutes.
              </p>
            </div>
            <Badge variant="secondary" className="text-xs">
              {generationStatus === "pending" ? "Queued..." : "Building your plan..."}
            </Badge>
          </CardContent>
        </Card>
      </div>
    );
  }

  // No plan — show onboarding prompt
  if (!plan) {
    return (
      <div className="flex flex-col gap-6">
        <Card className="gradient-border overflow-visible">
          <CardContent className="flex flex-col items-center gap-5 py-10 text-center bg-mesh rounded-xl">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15 glow-primary">
              <Target className="h-8 w-8 text-primary" />
            </div>
            <div>
              <p className="text-xl font-bold tracking-tight">Get Your Training Plan</p>
              <p className="mt-2 max-w-xs text-sm text-muted-foreground leading-relaxed">
                Answer a few questions and our AI coach will generate a personalized
                HYROX training plan tailored to your fitness level and goals.
              </p>
            </div>
            <Button size="lg" onClick={() => router.push("/hyrox/onboarding")} className="mt-1">
              <Zap className="h-4 w-4" />
              Start Setup
            </Button>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="flex flex-col items-center gap-1.5 py-5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
                <Timer className="h-4 w-4 text-blue-400" />
              </div>
              <span className="text-2xl font-bold tabular-nums font-mono">--:--</span>
              <span className="text-[11px] text-muted-foreground">Best Time</span>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col items-center gap-1.5 py-5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
                <TrendingUp className="h-4 w-4 text-emerald-400" />
              </div>
              <span className="text-2xl font-bold tabular-nums font-mono">--</span>
              <span className="text-[11px] text-muted-foreground">Races</span>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Plan completed — show dashboard summary
  const philosophy = plan.trainingPhilosophy as { summary?: string } | null;

  return (
    <div className="flex flex-col gap-4">
      {/* Hero card */}
      <Card className="gradient-border overflow-visible">
        <CardContent className="py-8 text-center bg-mesh rounded-xl">
          <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            {plan.title}
          </p>
          <p className="mt-2 text-lg font-semibold">
            {plan.totalWeeks}-Week Training Plan
          </p>
          <div className="mt-3 flex items-center justify-center gap-3 text-sm text-muted-foreground">
            <span>{plan.startDate} → {plan.endDate}</span>
          </div>
          {plan.generationStatus === "completed" && (
            <Badge variant="secondary" className="mt-3 text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
              Plan Ready
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="outline"
          className="h-auto py-4 flex-col gap-1"
          onClick={() => router.push("/hyrox/plan")}
        >
          <span className="text-sm font-semibold">View Plan</span>
          <span className="text-[10px] text-muted-foreground">Weekly sessions</span>
        </Button>
        <Button
          variant="outline"
          className="h-auto py-4 flex-col gap-1"
          onClick={() => router.push("/hyrox/scenarios")}
        >
          <span className="text-sm font-semibold">Race Scenarios</span>
          <span className="text-[10px] text-muted-foreground">Split strategies</span>
        </Button>
      </div>

      {/* Redo onboarding / new plan action */}
      <Button
        variant="ghost"
        className="w-full h-auto py-3 flex-col gap-0.5 text-muted-foreground"
        onClick={() => {
          if (confirm("This will walk you through onboarding again with your current values pre-filled. Your current plan will be archived and a new one generated. Continue?")) {
            // Clear any stale localStorage draft so DB profile values take priority
            try { localStorage.removeItem("hyrox-onboarding-draft"); } catch {}
            router.push("/hyrox/onboarding");
          }
        }}
      >
        <span className="text-xs font-medium">Redo Onboarding</span>
        <span className="text-[10px]">Review &amp; update your profile, then generate a new plan</span>
      </Button>

      {/* Philosophy summary */}
      {philosophy?.summary && (
        <Card>
          <CardContent className="py-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Training Philosophy
            </p>
            <p className="text-sm leading-relaxed">{philosophy.summary}</p>
          </CardContent>
        </Card>
      )}

      {/* Plan history */}
      <PlanHistorySection activePlanId={plan.id} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plan history section
// ---------------------------------------------------------------------------

function PlanHistorySection({ activePlanId }: { activePlanId: string }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const { data: plans } = usePlanHistory(expanded);

  const archivedPlans = plans?.filter(
    (p) => p.id !== activePlanId && p.status === "archived" && p.generationStatus === "completed"
  );

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Archive className="h-3 w-3" />
        View past plans
        <ChevronDown className="h-3 w-3" />
      </button>
    );
  }

  if (!archivedPlans || archivedPlans.length === 0) {
    return (
      <div className="text-center">
        <button
          onClick={() => setExpanded(false)}
          className="flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto"
        >
          <Archive className="h-3 w-3" />
          Past plans
          <ChevronUp className="h-3 w-3" />
        </button>
        <p className="text-xs text-muted-foreground py-2">No past plans yet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => setExpanded(false)}
        className="flex items-center justify-center gap-1.5 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Archive className="h-3 w-3" />
        Past plans
        <ChevronUp className="h-3 w-3" />
      </button>
      {archivedPlans.map((p) => (
        <Card key={p.id}>
          <CardContent className="flex items-center justify-between py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{p.title}</p>
              <p className="text-[10px] text-muted-foreground">
                {p.totalWeeks} weeks &middot; {p.startDate} → {p.endDate}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 text-xs h-7"
              onClick={() => router.push(`/hyrox/plan?planId=${p.id}`)}
            >
              View
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
