"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Timer, TrendingUp, Target } from "lucide-react";
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
        <Card className="ring-primary/20 bg-primary/5">
          <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
            <div className="rounded-full bg-primary/10 p-4">
              <Target className="h-8 w-8 text-primary" />
            </div>
            <div>
              <p className="text-lg font-semibold">Get Your Training Plan</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Answer a few questions and we will generate a personalized HYROX
                training plan tailored to your fitness level and goals.
              </p>
            </div>
            <Button size="lg" onClick={() => router.push("/hyrox/onboarding")}>
              Start Setup
            </Button>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="flex flex-col items-center gap-1 py-5">
              <Timer className="h-5 w-5 text-muted-foreground" />
              <span className="text-2xl font-bold tabular-nums">--:--</span>
              <span className="text-xs text-muted-foreground">Best Time</span>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col items-center gap-1 py-5">
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
              <span className="text-2xl font-bold tabular-nums">--</span>
              <span className="text-xs text-muted-foreground">Races</span>
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
