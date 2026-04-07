"use client";

import { useRouter } from "next/navigation";
import { OnboardingWizard } from "@/components/hyrox/onboarding-wizard";
import type { GeneratedPlan } from "@/lib/plan-generator";

export default function HyroxOnboardingPage() {
  const router = useRouter();

  const handleComplete = (plan: GeneratedPlan) => {
    localStorage.setItem("hyrox-plan", JSON.stringify(plan));
    router.push("/hyrox");
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">HYROX Setup</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Let&apos;s build your personalized training plan.
        </p>
      </div>
      <OnboardingWizard onComplete={handleComplete} />
    </div>
  );
}
