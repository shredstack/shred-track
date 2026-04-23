"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "shredtrack-upgrade-card-dismissed";

/**
 * Shown on the /hyrox dashboard for users on a generic (free) plan. Pitches
 * the personalized upgrade with one line of value and a CTA that routes
 * into the existing personalized onboarding (which, when paywall is
 * enforced, will gate at the API layer).
 *
 * Dismissible — once the user closes it, we remember and don't re-nag until
 * they clear local storage or create a new free plan.
 */
export function UpgradeCard() {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(true);

  // Hydrate client-side only to avoid SSR mismatch on localStorage read.
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "true");
    } catch {
      setDismissed(false);
    }
  }, []);

  if (dismissed) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "true");
    } catch {
      // noop
    }
    setDismissed(true);
  }

  return (
    <Card className="border-amber-500/30 bg-amber-500/5 overflow-visible">
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-400" />
            <p className="text-sm font-semibold">
              Want this plan built around <em>you</em>?
            </p>
          </div>
          <button
            onClick={dismiss}
            aria-label="Dismiss upgrade card"
            className="text-muted-foreground hover:text-foreground -mt-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Your personalized plan adapts to your current station times, real
          race date, equipment, and weak spots. Same app — deeper calibration.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() => router.push("/hyrox/onboarding")}
        >
          Upgrade to Personalized
        </Button>
      </CardContent>
    </Card>
  );
}
