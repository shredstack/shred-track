"use client";

import { useState } from "react";
import { Loader2, BarChart3, Calculator, Timer } from "lucide-react";
import { useActivePlan } from "@/hooks/useHyroxPlan";
import { ScenariosTab } from "@/components/hyrox/scenarios-tab";
import { RaceCalculator } from "@/components/hyrox/race-calculator";
import { RaceTimerFlow } from "@/components/hyrox/race-timer";

type Tab = "scenarios" | "calculator" | "timer";

const TABS = [
  { key: "timer" as const, label: "Timer", icon: Timer },
  { key: "scenarios" as const, label: "Scenarios", icon: BarChart3 },
  { key: "calculator" as const, label: "Calculator", icon: Calculator },
];

export default function HyroxRaceToolsPage() {
  const { data: plan, isLoading } = useActivePlan();
  const [activeTab, setActiveTab] = useState<Tab>("timer");

  const hasPlan = plan && plan.generationStatus === "completed";

  return (
    <div className="flex flex-col gap-4">
      {/* Sub-tab switcher */}
      <div className="flex rounded-lg bg-white/[0.03] p-1 gap-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-all duration-200 ${
              activeTab === key
                ? "bg-primary/15 text-primary glow-primary-sm"
                : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "timer" && <RaceTimerFlow />}

      {activeTab === "scenarios" && (
        <>
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !hasPlan ? (
            <div className="flex flex-col items-center gap-4 py-14 text-center">
              <p className="font-bold text-lg">No Scenarios Yet</p>
              <p className="max-w-xs text-sm text-muted-foreground leading-relaxed">
                Race-day scenarios will be generated as part of your training plan.
                Complete the HYROX onboarding to get started.
              </p>
            </div>
          ) : (
            <ScenariosTab planId={plan.id} />
          )}
        </>
      )}

      {activeTab === "calculator" && (
        <>
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <RaceCalculator planId={hasPlan ? plan.id : undefined} />
          )}
        </>
      )}
    </div>
  );
}
