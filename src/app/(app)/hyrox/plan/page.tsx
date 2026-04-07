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

  return (
    <PlanView
      plan={plan}
      onSelectSession={setSelectedSession}
      onUpdateSession={handleUpdateSession}
    />
  );
}
