"use client";

import { useState, useEffect } from "react";
import { PlanView } from "@/components/hyrox/plan-view";
import { SessionDetail } from "@/components/hyrox/session-detail";
import type { GeneratedPlan, PlanSession } from "@/lib/plan-generator";

export default function HyroxPlanPage() {
  const [plan, setPlan] = useState<GeneratedPlan | null>(null);
  const [selectedSession, setSelectedSession] = useState<PlanSession | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("hyrox-plan");
    if (stored) {
      try {
        setPlan(JSON.parse(stored));
      } catch {
        // ignore bad data
      }
    }
  }, []);

  const savePlan = (updated: GeneratedPlan) => {
    setPlan(updated);
    localStorage.setItem("hyrox-plan", JSON.stringify(updated));
  };

  const handleUpdateSession = (sessionId: string, updates: Partial<PlanSession>) => {
    if (!plan) return;
    const updated = {
      ...plan,
      weeks: plan.weeks.map((week) => ({
        ...week,
        sessions: week.sessions.map((s) =>
          s.id === sessionId ? { ...s, ...updates } : s
        ),
      })),
    };
    savePlan(updated);
  };

  const handleLogSession = (sessionId: string, data: { actualPace?: string; distance?: string; time?: string; reps?: string; weight?: string; rpe: number; notes: string }) => {
    handleUpdateSession(sessionId, {
      status: "completed",
      loggedData: data as Record<string, string | number>,
    });
    if (selectedSession?.id === sessionId) {
      setSelectedSession({ ...selectedSession, status: "completed", loggedData: data as Record<string, string | number> });
    }
  };

  if (selectedSession) {
    return (
      <SessionDetail
        session={selectedSession}
        onBack={() => setSelectedSession(null)}
        onLog={handleLogSession}
      />
    );
  }

  if (!plan) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="font-semibold">No Plan Yet</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          Complete the HYROX onboarding to generate your personalized training plan.
        </p>
        <a href="/hyrox/onboarding">
          <button className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            Start Setup
          </button>
        </a>
      </div>
    );
  }

  return (
    <PlanView
      plan={plan}
      onSelectSession={setSelectedSession}
      onUpdateSession={handleUpdateSession}
    />
  );
}
