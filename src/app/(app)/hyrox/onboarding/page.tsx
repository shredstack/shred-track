"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { OnboardingWizard } from "@/components/hyrox/onboarding-wizard";
import { usePlanStatus } from "@/hooks/useHyroxPlan";
import { usePlanCredits } from "@/hooks/usePlanCredits";
import { useIsNative } from "@/hooks/useIsNative";

export default function HyroxOnboardingPage() {
  const router = useRouter();
  const [planId, setPlanId] = useState<string | null>(null);

  // Personalized plan generation is web-only on the initial iOS release.
  // The CTAs that route here are hidden on native, but bounce anyone who
  // arrives via deep link or a stale tab back to the dashboard.
  const isNative = useIsNative();
  useEffect(() => {
    if (isNative) router.replace("/hyrox");
  }, [isNative, router]);

  // Credit gate — personalized onboarding assumes the user has something to
  // spend. If not, send them back to the chooser where they can start free.
  const credits = usePlanCredits();
  useEffect(() => {
    if (isNative) return;
    if (credits.isLoading) return;
    if (!credits.canGenerate) {
      toast.info("Purchase a personalized plan to continue.");
      router.replace("/hyrox");
    }
  }, [isNative, credits.isLoading, credits.canGenerate, router]);

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

  if (isNative || credits.isLoading || !credits.canGenerate) {
    return (
      <div className="flex items-center justify-center py-14">
        <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
      </div>
    );
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
