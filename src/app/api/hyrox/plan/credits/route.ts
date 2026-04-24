// ---------------------------------------------------------------------------
// GET /api/hyrox/plan/credits
//
// Client-facing snapshot of the user's ability to generate a personalized
// plan. Reads from the purchase/generation ledger + VIP grants. Used by
// usePlanCredits() on the client to decide whether to show "Generate" vs.
// "Buy — $9.99" vs. "Use VIP credit".
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getCreditStatus, PERSONALIZED_PLAN_PRICE_USD } from "@/lib/plan-credits";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const status = await getCreditStatus(user.id);
  return NextResponse.json({
    ...status,
    priceUsd: PERSONALIZED_PLAN_PRICE_USD,
  });
}
