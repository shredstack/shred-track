"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, AlertTriangle, Clock } from "lucide-react";
import { useActivePlan, useGeneratePlan, usePlanStatus } from "@/hooks/useHyroxPlan";
import { PlanViewV2 } from "@/components/hyrox/plan-view-v2";

const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

export default function HyroxPlanContent() {
  const searchParams = useSearchParams();
  const overridePlanId = searchParams.get("planId");

  const { data: plan, isLoading } = useActivePlan();
  const generatePlan = useGeneratePlan();

  // Poll detailed status (with session count) while generating
  const isGenerating = plan?.generationStatus === "generating" || plan?.generationStatus === "pending";
  const { data: status } = usePlanStatus(isGenerating ? plan?.id : null);

  const isStale = useMemo(() => {
    if (!status?.createdAt || !isGenerating) return false;
    const elapsed = Date.now() - new Date(status.createdAt).getTime();
    return elapsed > STALE_THRESHOLD_MS;
  }, [status?.createdAt, isGenerating]);

  // If a specific planId is in the URL, show that plan (read-only for archived)
  if (overridePlanId) {
    return <PlanViewV2 planId={overridePlanId} isReadOnly />;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (plan?.generationStatus === "failed") {
    return (
      <div className="flex flex-col items-center gap-4 py-14 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>
        <p className="font-bold text-lg">Plan Generation Failed</p>
        <p className="max-w-xs text-sm text-muted-foreground leading-relaxed">
          Something went wrong while generating your plan. Please try again.
        </p>
        <button
          onClick={() => generatePlan.mutate()}
          disabled={generatePlan.isPending}
          className="mt-1 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {generatePlan.isPending ? "Generating…" : "Try Again"}
        </button>
      </div>
    );
  }

  if (!plan || plan.generationStatus !== "completed") {
    // No plan at all — prompt onboarding
    if (!plan) {
      return (
        <div className="flex flex-col items-center gap-4 py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <svg className="h-6 w-6 text-primary/60" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
          </div>
          <p className="font-bold text-lg">No Plan Yet</p>
          <p className="max-w-xs text-sm text-muted-foreground leading-relaxed">
            Complete the HYROX onboarding to generate your personalized training plan.
          </p>
          <a href="/hyrox/onboarding">
            <button className="mt-1 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
              Start Setup
            </button>
          </a>
        </div>
      );
    }

    // Generation appears stuck
    if (isStale) {
      return (
        <div className="flex flex-col items-center gap-4 py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10">
            <Clock className="h-6 w-6 text-amber-500" />
          </div>
          <p className="font-bold text-lg">Taking Longer Than Expected</p>
          <p className="max-w-xs text-sm text-muted-foreground leading-relaxed">
            Plan generation seems to have stalled. You can retry — it won&apos;t
            affect your profile or settings.
          </p>
          <button
            onClick={() => generatePlan.mutate()}
            disabled={generatePlan.isPending}
            className="mt-1 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {generatePlan.isPending ? "Generating…" : "Retry Generation"}
          </button>
        </div>
      );
    }

    // Actively generating — show progress
    const sessionsGenerated = status?.sessionsGenerated ?? 0;
    const expectedSessions = status?.expectedSessions ?? 0;
    const progressPct = expectedSessions > 0
      ? Math.min(Math.round((sessionsGenerated / expectedSessions) * 100), 99)
      : 0;

    const progressLabel = sessionsGenerated === 0
      ? "Setting up your plan…"
      : `Building week ${Math.ceil(sessionsGenerated / 7)} of ${status?.totalWeeks ?? "?"}`;

    return (
      <div className="flex flex-col items-center gap-4 py-14 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
          <Loader2 className="h-6 w-6 animate-spin text-primary/60" />
        </div>
        <p className="font-bold text-lg">Generating Your Plan</p>
        <p className="max-w-xs text-sm text-muted-foreground leading-relaxed">
          {progressLabel}
        </p>
        {expectedSessions > 0 && (
          <div className="w-56">
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">{progressPct}%</p>
          </div>
        )}
      </div>
    );
  }

  return <PlanViewV2 planId={plan.id} />;
}
