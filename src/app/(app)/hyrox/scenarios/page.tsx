"use client";

import { Loader2 } from "lucide-react";
import { useActivePlan } from "@/hooks/useHyroxPlan";
import { ScenariosTab } from "@/components/hyrox/scenarios-tab";

export default function HyroxScenariosPage() {
  const { data: plan, isLoading } = useActivePlan();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!plan || plan.generationStatus !== "completed") {
    return (
      <div className="flex flex-col items-center gap-4 py-14 text-center">
        <p className="font-bold text-lg">No Scenarios Yet</p>
        <p className="max-w-xs text-sm text-muted-foreground leading-relaxed">
          Race-day scenarios will be generated as part of your training plan.
          Complete the HYROX onboarding to get started.
        </p>
      </div>
    );
  }

  return <ScenariosTab planId={plan.id} />;
}
