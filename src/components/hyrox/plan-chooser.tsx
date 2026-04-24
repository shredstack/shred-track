"use client";

import { useRouter } from "next/navigation";
import { Check, Loader2, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePlanCredits } from "@/hooks/usePlanCredits";
import {
  PurchaseCancelledError,
  usePurchasePersonalized,
} from "@/hooks/usePurchasePersonalized";

/**
 * Entry screen for new HYROX users. Presents a Free (generic template) path
 * and a Personalized (AI-generated) path. Free is the default visual
 * emphasis — this isn't a hard paywall.
 */
export function PlanChooser() {
  const router = useRouter();
  const credits = usePlanCredits();
  const purchase = usePurchasePersonalized();

  async function handleUpgrade() {
    // If a credit is already available (VIP, bypass, or a past purchase),
    // skip checkout and go straight to onboarding.
    if (credits.canGenerate) {
      router.push("/hyrox/onboarding");
      return;
    }

    try {
      await purchase.mutateAsync();
      router.push("/hyrox/onboarding");
    } catch (err) {
      if (err instanceof PurchaseCancelledError) return;
      toast.error(
        err instanceof Error ? err.message : "Purchase failed. Please try again.",
      );
    }
  }

  const personalizedCta = (() => {
    if (purchase.isPending) return "Processing...";
    if (credits.isLoading) return "Upgrade to Personalized";
    if (credits.canGenerate) {
      if (credits.nextSource === "vip") return "Use VIP credit";
      if (credits.nextSource === "purchase") return "Use your credit";
      return "Continue";
    }
    return `Upgrade to Personalized — $${credits.priceUsd}`;
  })();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col items-center gap-2 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15">
          <Zap className="h-6 w-6 text-primary" />
        </div>
        <h1 className="mt-1 text-xl font-bold tracking-tight">Build your HYROX plan</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Pick the plan that fits where you are right now. You can upgrade any time.
        </p>
      </header>

      {/* Free card — primary emphasis */}
      <Card className="gradient-border overflow-visible">
        <CardContent className="flex flex-col gap-4 bg-mesh rounded-xl py-5">
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-primary">
                Free Plan
              </p>
              <p className="mt-0.5 text-lg font-bold">$0 &middot; Ready in seconds</p>
            </div>
            <Badge variant="secondary" className="text-[10px]">
              Recommended to start
            </Badge>
          </div>

          <FeatureList
            items={[
              "Structured 18-week plan with periodized phases",
              "Built for your gender, race format, and running level",
              "All 8 HYROX stations, progressive weight + pace targets",
              "Same plan view, logging, and race tools as personalized",
            ]}
          />

          <Button
            size="lg"
            className="w-full"
            onClick={() => router.push("/hyrox/free-onboarding")}
          >
            Start Free
          </Button>
          <p className="text-center text-[10px] text-muted-foreground">
            Just 5 questions — no credit card.
          </p>
        </CardContent>
      </Card>

      {/* Personalized card — secondary emphasis */}
      <Card>
        <CardContent className="flex flex-col gap-4 py-5">
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Personalized Plan
              </p>
              <p className="mt-0.5 text-lg font-bold">
                <Sparkles className="inline h-4 w-4 mr-1 align-baseline text-amber-400" />
                AI-generated
              </p>
            </div>
          </div>

          <FeatureList
            items={[
              "4–24 weeks, anchored to your race date",
              "AI plan tuned to your current station times and weak spots",
              "Personalized race-day scenarios with current vs. aspirational splits",
              "Weekly regeneration if life gets in the way",
            ]}
          />

          <Button
            size="lg"
            variant="outline"
            className="w-full"
            onClick={handleUpgrade}
            disabled={purchase.isPending}
          >
            {purchase.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {personalizedCta}
          </Button>
          {credits.isVip && credits.vipRemaining > 0 && (
            <p className="text-center text-[10px] text-muted-foreground">
              VIP: {credits.vipRemaining} plan{credits.vipRemaining === 1 ? "" : "s"} remaining this year
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FeatureList({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <span className="text-muted-foreground leading-snug">{item}</span>
        </li>
      ))}
    </ul>
  );
}
