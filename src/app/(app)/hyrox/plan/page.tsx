"use client";

import { useSearchParams } from "next/navigation";
import { Loader2, AlertTriangle } from "lucide-react";
import { useActivePlan, useGeneratePlan } from "@/hooks/useHyroxPlan";
import { PlanViewV2 } from "@/components/hyrox/plan-view-v2";

export default function HyroxPlanPage() {
  const searchParams = useSearchParams();
  const overridePlanId = searchParams.get("planId");

  const { data: plan, isLoading } = useActivePlan();
  const generatePlan = useGeneratePlan();

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
    return (
      <div className="flex flex-col items-center gap-4 py-14 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
          <svg className="h-6 w-6 text-primary/60" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
        </div>
        <p className="font-bold text-lg">
          {plan?.generationStatus === "generating" || plan?.generationStatus === "pending"
            ? "Generating Your Plan"
            : "No Plan Yet"}
        </p>
        <p className="max-w-xs text-sm text-muted-foreground leading-relaxed">
          {plan?.generationStatus === "generating" || plan?.generationStatus === "pending"
            ? "Your plan is being generated. This usually takes 10-20 minutes."
            : "Complete the HYROX onboarding to generate your personalized training plan."}
        </p>
        {(plan?.generationStatus === "generating" || plan?.generationStatus === "pending") && (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        )}
        {!plan && (
          <a href="/hyrox/onboarding">
            <button className="mt-1 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
              Start Setup
            </button>
          </a>
        )}
      </div>
    );
  }

  return <PlanViewV2 planId={plan.id} />;
}
