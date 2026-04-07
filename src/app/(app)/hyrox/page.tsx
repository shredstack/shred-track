"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Timer, TrendingUp, Target, Zap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dashboard } from "@/components/hyrox/dashboard";
import type { GeneratedPlan } from "@/lib/plan-generator";

export default function HyroxPage() {
  const router = useRouter();
  const [plan, setPlan] = useState<GeneratedPlan | null>(null);

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
                Answer a few questions and we&apos;ll generate a personalized HYROX
                training plan tailored to your fitness level and goals.
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

  return (
    <div className="flex flex-col gap-4">
      <Dashboard plan={plan} />

      <div className="flex justify-center pt-4">
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground"
          onClick={() => {
            localStorage.removeItem("hyrox-plan");
            setPlan(null);
          }}
        >
          Reset Plan
        </Button>
      </div>
    </div>
  );
}
