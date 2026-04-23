// ---------------------------------------------------------------------------
// useEntitlements
//
// Client-side view of the authenticated user's entitlement state, read from
// our server-side RevenueCat mirror. Cheap to call — React Query caches
// the result and webhook-driven mutations invalidate the queryKey.
//
// Today this is strictly a read of /api/hyrox/entitlements. When the
// RevenueCat client SDK is installed, the purchase flow should:
//   1. Call `Purchases.purchase(...)` via the SDK,
//   2. After success, call `queryClient.invalidateQueries(['hyrox-entitlements'])`
//      so the UI re-reads our mirror (which the webhook has just updated).
//
// Do NOT treat the local RC SDK customerInfo as authoritative — always
// reconcile against our server mirror. This keeps the gate consistent
// across devices and sidesteps RC's eventually-consistent client cache.
// ---------------------------------------------------------------------------

import { useQuery } from "@tanstack/react-query";

export interface EntitlementsResponse {
  entitlements: {
    hyrox_personalized_plan: boolean;
  };
  /**
   * Whether paywall enforcement is turned on for this deployment. When
   * false, the `/api/hyrox/plan/generate` endpoint passes through without
   * an entitlement check — useful in dev.
   */
  paywallEnforced: boolean;
}

export function useEntitlements() {
  const query = useQuery({
    queryKey: ["hyrox-entitlements"],
    queryFn: async () => {
      const response = await fetch("/api/hyrox/entitlements");
      if (!response.ok) throw new Error("Failed to fetch entitlements");
      return response.json() as Promise<EntitlementsResponse>;
    },
    staleTime: 60_000, // entitlements rarely change — avoid thrashing
  });

  const data = query.data;

  return {
    isLoading: query.isLoading,
    paywallEnforced: data?.paywallEnforced ?? false,
    hasPersonalized: data?.entitlements.hyrox_personalized_plan ?? false,
    /**
     * Should we gate the personalized flow? True only when the paywall is
     * enforced AND the user doesn't have the entitlement.
     */
    shouldGatePersonalized:
      !!data && data.paywallEnforced && !data.entitlements.hyrox_personalized_plan,
  };
}
