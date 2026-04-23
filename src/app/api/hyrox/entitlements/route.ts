// ---------------------------------------------------------------------------
// GET /api/hyrox/entitlements
//
// Returns the authenticated user's active entitlements, read from the local
// mirror populated by the RevenueCat webhook. Also reports whether paywall
// enforcement is turned on for this deployment — clients use this to decide
// whether to show upgrade CTAs vs. route straight to the paid flow.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import {
  activeEntitlementsFor,
  isPaywallEnforced,
  type EntitlementKey,
} from "@/lib/entitlements";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const active = await activeEntitlementsFor(user.id);
  const activeSet = new Set<EntitlementKey>(active);

  return NextResponse.json({
    entitlements: {
      hyrox_personalized_plan: activeSet.has("hyrox_personalized_plan"),
    },
    paywallEnforced: isPaywallEnforced(),
  });
}
