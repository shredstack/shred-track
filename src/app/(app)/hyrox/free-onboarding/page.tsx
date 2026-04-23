"use client";

import { useRouter } from "next/navigation";
import { FreeOnboardingWizard } from "@/components/hyrox/free-onboarding-wizard";

export default function HyroxFreeOnboardingPage() {
  const router = useRouter();

  return (
    <FreeOnboardingWizard
      onCompleted={() => {
        // Free plans are ready immediately — route straight to the dashboard.
        router.push("/hyrox");
      }}
    />
  );
}
