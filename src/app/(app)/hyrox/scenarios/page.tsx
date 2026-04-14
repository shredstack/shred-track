"use client";

import { useState } from "react";
import { Loader2, BarChart3, Calculator } from "lucide-react";
import { useActivePlan } from "@/hooks/useHyroxPlan";
import { ScenariosTab } from "@/components/hyrox/scenarios-tab";
import { RaceCalculator } from "@/components/hyrox/race-calculator";

type Tab = "scenarios" | "calculator";

export default function HyroxScenariosPage() {
  const { data: plan, isLoading } = useActivePlan();
  const [activeTab, setActiveTab] = useState<Tab>("scenarios");

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

  return (
    <div className="flex flex-col gap-4">
      {/* Top-level tab switcher */}
      <div className="flex rounded-lg bg-white/[0.03] p-1 gap-1">
        <button
          onClick={() => setActiveTab("scenarios")}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-all duration-200 ${
            activeTab === "scenarios"
              ? "bg-primary/15 text-primary glow-primary-sm"
              : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
          }`}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          Scenarios
        </button>
        <button
          onClick={() => setActiveTab("calculator")}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-all duration-200 ${
            activeTab === "calculator"
              ? "bg-primary/15 text-primary glow-primary-sm"
              : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
          }`}
        >
          <Calculator className="h-3.5 w-3.5" />
          Race Calculator
        </button>
      </div>

      {/* Tab content */}
      {activeTab === "scenarios" ? (
        <ScenariosTab planId={plan.id} />
      ) : (
        <RaceCalculator planId={plan.id} />
      )}
    </div>
  );
}
