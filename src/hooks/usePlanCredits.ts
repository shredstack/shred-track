// ---------------------------------------------------------------------------
// usePlanCredits
//
// Client-side view of the authenticated user's ability to generate a
// personalized HYROX plan. Backed by /api/hyrox/plan/credits.
//
// Query key is `["hyrox-plan-credits"]`. After a purchase or VIP grant, the
// caller should invalidate this key to re-pull.
// ---------------------------------------------------------------------------

import { useQuery } from "@tanstack/react-query";
import type { CreditSource } from "@/lib/plan-credits";

export interface PlanCreditsResponse {
  canGenerate: boolean;
  nextSource: CreditSource | null;
  paywallEnforced: boolean;
  purchases: { total: number; consumed: number; remaining: number };
  vip: {
    isVip: boolean;
    plansPerYear: number | null;
    usedThisYear: number;
    remaining: number;
  };
  priceUsd: string;
}

export const PLAN_CREDITS_QUERY_KEY = ["hyrox-plan-credits"] as const;

export function usePlanCredits() {
  const query = useQuery({
    queryKey: PLAN_CREDITS_QUERY_KEY,
    queryFn: async () => {
      const res = await fetch("/api/hyrox/plan/credits");
      if (!res.ok) throw new Error("Failed to load plan credits");
      return (await res.json()) as PlanCreditsResponse;
    },
    staleTime: 30_000,
  });

  return {
    isLoading: query.isLoading,
    data: query.data,
    canGenerate: query.data?.canGenerate ?? false,
    nextSource: query.data?.nextSource ?? null,
    paywallEnforced: query.data?.paywallEnforced ?? false,
    purchasesRemaining: query.data?.purchases.remaining ?? 0,
    vipRemaining: query.data?.vip.remaining ?? 0,
    isVip: query.data?.vip.isVip ?? false,
    priceUsd: query.data?.priceUsd ?? "9.99",
  };
}
