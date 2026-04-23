// ---------------------------------------------------------------------------
// POST /api/webhooks/revenuecat
//
// RevenueCat delivers subscription lifecycle events here. We authenticate
// via a shared secret in the Authorization header — RC's default webhook
// configuration uses a static "Authorization: Bearer <secret>" token which
// you set in both the RC dashboard and the REVENUECAT_WEBHOOK_SECRET env.
//
// The endpoint is idempotent: the same event can be redelivered without
// side effects. Entitlement state is derived from the *latest* event we've
// seen per (user, entitlement_key) — see applyRCEvent in lib/entitlements.
//
// Setup checklist (human action):
//   1. Create an entitlement in RevenueCat named `hyrox_personalized_plan`.
//   2. Attach the iOS / Android / web products to that entitlement.
//   3. In RC dashboard → Integrations → Webhooks, set URL to
//      https://<your-domain>/api/webhooks/revenuecat
//      and set the Authorization header to "Bearer <REVENUECAT_WEBHOOK_SECRET>".
//   4. Set `REVENUECAT_WEBHOOK_SECRET` in env (.env.local locally, platform
//      env in prod).
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { applyRCEvent, type RCWebhookPayload } from "@/lib/entitlements";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  // ---- Auth ----
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!secret) {
    // Fail closed — refuse to process until the secret is configured.
    console.error("[rc-webhook] REVENUECAT_WEBHOOK_SECRET not configured");
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 503 },
    );
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!timingSafeEqual(authHeader, expected)) {
    console.warn("[rc-webhook] auth mismatch");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ---- Parse + apply ----
  let payload: RCWebhookPayload;
  try {
    payload = (await req.json()) as RCWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!payload.event || !payload.event.type || !payload.event.app_user_id) {
    return NextResponse.json({ error: "Malformed payload" }, { status: 400 });
  }

  try {
    const result = await applyRCEvent(payload.event);
    console.log(
      `[rc-webhook] ${payload.event.type} id=${payload.event.id} user=${payload.event.app_user_id} applied=${result.applied} reason=${result.reason ?? "ok"}`,
    );
    return NextResponse.json({ ok: true, applied: result.applied });
  } catch (err) {
    console.error(`[rc-webhook] apply failed for event ${payload.event.id}:`, err);
    // Return 500 so RC retries — the event will be redelivered.
    return NextResponse.json({ error: "Failed to apply event" }, { status: 500 });
  }
}

/**
 * Constant-time string comparison. Node's native crypto.timingSafeEqual
 * requires Buffer inputs and matching lengths — this wrapper handles both.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
