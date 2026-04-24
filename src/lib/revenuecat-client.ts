// ---------------------------------------------------------------------------
// RevenueCat Web SDK — client-only singleton.
//
// Configured on demand with the authenticated Supabase user.id so the RC
// appUserID stays stable across web, iOS, and Android. When the user logs
// out, call `resetRevenueCat()` before the next login.
//
// This module should never be imported from a server component. All callers
// are client components/hooks.
// ---------------------------------------------------------------------------

import { Purchases, type Package } from "@revenuecat/purchases-js";

let configuredForUserId: string | null = null;

export function getRevenueCatApiKey(): string {
  const key = process.env.NEXT_PUBLIC_REVENUECAT_API_KEY;
  if (!key || key.startsWith("<")) {
    throw new Error(
      "NEXT_PUBLIC_REVENUECAT_API_KEY is not configured. Set a real RC Web Billing public key in .env.local.",
    );
  }
  return key;
}

export function isRevenueCatConfigured(userId: string): boolean {
  return configuredForUserId === userId && Purchases.isConfigured();
}

export function configureRevenueCat(userId: string): Purchases {
  if (isRevenueCatConfigured(userId)) {
    return Purchases.getSharedInstance();
  }
  const apiKey = getRevenueCatApiKey();
  const instance = Purchases.configure({ apiKey, appUserId: userId });
  configuredForUserId = userId;
  return instance;
}

export function resetRevenueCat() {
  configuredForUserId = null;
}

/**
 * Returns the current offering's first package — our single $9.99 plan
 * product. When we add bundles, branch here on a configurable identifier.
 */
export async function getPersonalizedPlanPackage(userId: string): Promise<Package> {
  const purchases = configureRevenueCat(userId);
  const offerings = await purchases.getOfferings();
  const current = offerings.current;
  if (!current) {
    throw new Error(
      "No current offering configured in RevenueCat. Set up the 'current' offering with your personalized-plan product attached.",
    );
  }
  const pkg = current.availablePackages[0];
  if (!pkg) {
    throw new Error(
      "Current offering has no packages. Attach the personalized-plan product in the RevenueCat dashboard.",
    );
  }
  return pkg;
}
