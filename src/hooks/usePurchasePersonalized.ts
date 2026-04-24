// ---------------------------------------------------------------------------
// usePurchasePersonalized
//
// Opens the RevenueCat Web Billing checkout for the personalized-plan
// product, then waits for our webhook-fed mirror to reflect the new credit
// before resolving. The webhook is asynchronous, so even after the RC SDK
// resolves we may need to poll /api/hyrox/plan/credits for a few seconds.
//
// After success, the caller typically calls router.push("/hyrox/onboarding")
// — usePlanCredits() will already report canGenerate=true.
// ---------------------------------------------------------------------------

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ErrorCode, type PurchasesError } from "@revenuecat/purchases-js";
import { createClient } from "@/lib/supabase/client";
import {
  configureRevenueCat,
  getPersonalizedPlanPackage,
} from "@/lib/revenuecat-client";
import {
  PLAN_CREDITS_QUERY_KEY,
  type PlanCreditsResponse,
} from "@/hooks/usePlanCredits";

const WEBHOOK_POLL_INTERVAL_MS = 1000;
const WEBHOOK_POLL_MAX_MS = 30_000;

export class PurchaseCancelledError extends Error {
  constructor() {
    super("Purchase cancelled");
    this.name = "PurchaseCancelledError";
  }
}

export function usePurchasePersonalized() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("You must be signed in to purchase");

      const purchases = configureRevenueCat(user.id);
      const pkg = await getPersonalizedPlanPackage(user.id);

      try {
        await purchases.purchase({ rcPackage: pkg });
      } catch (err) {
        const rcErr = err as PurchasesError;
        if (rcErr?.errorCode === ErrorCode.UserCancelledError) {
          throw new PurchaseCancelledError();
        }
        throw err;
      }

      // Poll our mirror until the webhook lands. The RC client-side result
      // doesn't tell us the webhook has processed, and our server is the
      // source of truth for canGenerate.
      const start = Date.now();
      while (Date.now() - start < WEBHOOK_POLL_MAX_MS) {
        const res = await fetch("/api/hyrox/plan/credits", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as PlanCreditsResponse;
          if (data.canGenerate) {
            queryClient.setQueryData(PLAN_CREDITS_QUERY_KEY, data);
            return data;
          }
        }
        await new Promise((r) => setTimeout(r, WEBHOOK_POLL_INTERVAL_MS));
      }

      // Webhook didn't land in time. The credit will eventually arrive, but
      // surface this so the caller can show a "payment processed — may take
      // a minute" message.
      throw new Error(
        "Payment completed but credit not yet reflected. Refresh in a moment.",
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PLAN_CREDITS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["hyrox-entitlements"] });
    },
  });
}
