"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { OnboardingWizard } from "@/components/hyrox/onboarding-wizard";
import { usePlanStatus } from "@/hooks/useHyroxPlan";

export default function HyroxOnboardingPage() {
  const router = useRouter();
  const [planId, setPlanId] = useState<string | null>(null);

  // Poll generation status after onboarding completes
  const { data: statusData } = usePlanStatus(planId);

  // Redirect to dashboard once plan is complete
  useEffect(() => {
    if (statusData?.generationStatus === "completed") {
      router.push("/hyrox");
    }
  }, [statusData?.generationStatus, router]);

  if (statusData?.generationStatus === "completed") {
    return null;
  }

  // Show generating state after onboarding is done
  if (planId) {
    return (
      <div className="flex flex-col items-center gap-6 py-14 text-center">
        <Loader2 className="h-10 w-10 text-primary animate-spin" />
        <div>
          <p className="text-xl font-bold tracking-tight">Building Your Plan</p>
          <p className="mt-2 max-w-xs text-sm text-muted-foreground leading-relaxed">
            Our AI coach is creating your personalized HYROX training plan with
            phased periodization, weekly sessions, and race-day scenarios.
          </p>
          <p className="mt-4 text-xs text-muted-foreground">
            This usually takes 10-20 minutes...
          </p>
        </div>
      </div>
    );
  }

  const handleComplete = (result: { planId: string }) => {
    setPlanId(result.planId);
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">HYROX Setup</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tell us about yourself so our AI coach can build your personalized plan.
        </p>
      </div>
      <OnboardingWizard onComplete={handleComplete} />
    </div>
  );
}
