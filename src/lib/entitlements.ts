// ---------------------------------------------------------------------------
// Entitlements — RevenueCat-mirrored subscription state.
//
// RevenueCat is the source of truth. This module reads/writes the local
// mirror table `hyrox_entitlements` which is updated by the RC webhook at
// /api/webhooks/revenuecat.
//
// Server-side paywall enforcement:
//   - `hasEntitlement(userId, 'hyrox_personalized_plan')` → boolean
//   - Guard in /api/hyrox/plan/generate is gated by the
//     HYROX_PAYWALL_ENFORCED env flag (off in dev, on in prod once RC is
//     live). See `isPaywallEnforced()` below.
// ---------------------------------------------------------------------------

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { hyroxEntitlements } from "@/db/schema";

export const ENTITLEMENT_PERSONALIZED = "hyrox_personalized_plan" as const;

export type EntitlementKey = typeof ENTITLEMENT_PERSONALIZED;

/** Check whether a user has an active entitlement. */
export async function hasEntitlement(userId: string, key: EntitlementKey): Promise<boolean> {
  const [row] = await db
    .select({ active: hyroxEntitlements.active, expiresAt: hyroxEntitlements.expiresAt })
    .from(hyroxEntitlements)
    .where(
      and(
        eq(hyroxEntitlements.userId, userId),
        eq(hyroxEntitlements.entitlementKey, key),
      ),
    )
    .limit(1);

  if (!row) return false;
  if (!row.active) return false;
  // Belt-and-braces: if expires_at is past, treat as inactive even if the
  // webhook hasn't fired yet.
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return false;
  return true;
}

/**
 * Is paywall enforcement turned on for this deployment? When false, all
 * entitlement checks short-circuit to allow — useful in dev until RC is
 * wired up, and for e2e tests that shouldn't depend on RC sandbox.
 */
export function isPaywallEnforced(): boolean {
  return process.env.HYROX_PAYWALL_ENFORCED === "true";
}

/**
 * Convenience: returns true if the user is entitled OR paywall enforcement
 * is off. This is the check your API route almost always wants.
 */
export async function isUserEntitledOrBypassed(userId: string, key: EntitlementKey): Promise<boolean> {
  if (!isPaywallEnforced()) return true;
  return hasEntitlement(userId, key);
}

/**
 * Return the set of entitlement keys that are currently active for a user.
 * Used by the /api/hyrox/entitlements GET endpoint to hydrate the client.
 */
export async function activeEntitlementsFor(userId: string): Promise<EntitlementKey[]> {
  const rows = await db
    .select()
    .from(hyroxEntitlements)
    .where(and(eq(hyroxEntitlements.userId, userId), eq(hyroxEntitlements.active, true)));
  const now = Date.now();
  return rows
    .filter((r) => !r.expiresAt || r.expiresAt.getTime() > now)
    .map((r) => r.entitlementKey as EntitlementKey);
}

// ---------------------------------------------------------------------------
// RevenueCat event shape (trimmed to fields we care about).
// Full schema: https://www.revenuecat.com/docs/integrations/webhooks/event-types
// ---------------------------------------------------------------------------

export type RCEventType =
  | "INITIAL_PURCHASE"
  | "RENEWAL"
  | "NON_RENEWING_PURCHASE"
  | "UNCANCELLATION"
  | "SUBSCRIPTION_EXTENDED"
  | "PRODUCT_CHANGE"
  | "CANCELLATION"
  | "EXPIRATION"
  | "BILLING_ISSUE"
  | "SUBSCRIBER_ALIAS"
  | "TRANSFER"
  | "TEST";

export interface RCEvent {
  type: RCEventType;
  id: string;
  app_user_id: string;                                // Our users.id
  original_app_user_id?: string;
  entitlement_ids?: string[] | null;
  product_id?: string;
  transaction_id?: string;
  expiration_at_ms?: number | null;
  purchased_at_ms?: number;
  event_timestamp_ms?: number;
  period_type?: "NORMAL" | "TRIAL" | "INTRO" | "PROMOTIONAL";
  // Price in minor units (e.g. 999 for $9.99). RC exposes this on purchase
  // events but the exact field varies by event version — we try both.
  price_in_purchased_currency?: number;
  price?: number;
  currency?: string;
}

export interface RCWebhookPayload {
  api_version: string;
  event: RCEvent;
}

/** Events that mean the entitlement should be active after processing. */
const ACTIVATING_TYPES = new Set<RCEventType>([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "NON_RENEWING_PURCHASE",
  "UNCANCELLATION",
  "SUBSCRIPTION_EXTENDED",
  "PRODUCT_CHANGE",
]);

/** Events that mean the entitlement should be inactive after processing. */
const DEACTIVATING_TYPES = new Set<RCEventType>([
  "CANCELLATION",
  "EXPIRATION",
  "BILLING_ISSUE",
]);

export function isIgnorableEventType(t: RCEventType): boolean {
  // TEST fires during webhook setup in the RC dashboard. TRANSFER and
  // SUBSCRIBER_ALIAS are identity-reconciliation events we don't model.
  return t === "TEST" || t === "TRANSFER" || t === "SUBSCRIBER_ALIAS";
}

/**
 * Apply a RevenueCat event to the entitlements mirror. Idempotent per
 * (user, entitlement_key): we always overwrite with the latest state.
 *
 * Uses last_event_at to skip out-of-order deliveries — if we've already
 * recorded a newer event, we don't regress to the older one.
 */
export async function applyRCEvent(event: RCEvent): Promise<{ applied: boolean; reason?: string }> {
  if (isIgnorableEventType(event.type)) {
    return { applied: false, reason: `ignored event type ${event.type}` };
  }

  const entitlementIds = event.entitlement_ids ?? [];
  if (entitlementIds.length === 0) {
    return { applied: false, reason: "no entitlement_ids on event" };
  }

  const activating = ACTIVATING_TYPES.has(event.type);
  const deactivating = DEACTIVATING_TYPES.has(event.type);
  if (!activating && !deactivating) {
    return { applied: false, reason: `unhandled event type ${event.type}` };
  }

  const eventAt = event.event_timestamp_ms
    ? new Date(event.event_timestamp_ms)
    : new Date();
  const expiresAt = event.expiration_at_ms
    ? new Date(event.expiration_at_ms)
    : null;

  for (const key of entitlementIds) {
    const [existing] = await db
      .select()
      .from(hyroxEntitlements)
      .where(
        and(
          eq(hyroxEntitlements.userId, event.app_user_id),
          eq(hyroxEntitlements.entitlementKey, key),
        ),
      )
      .limit(1);

    // Out-of-order protection: if we've already applied a newer event, skip.
    if (existing?.lastEventAt && existing.lastEventAt.getTime() > eventAt.getTime()) {
      continue;
    }

    const rawPeriodType = event.period_type?.toLowerCase();
    const periodType: "normal" | "trial" | "intro" | null = (() => {
      if (!rawPeriodType) return null;
      if (rawPeriodType === "normal" || rawPeriodType === "trial" || rawPeriodType === "intro") {
        return rawPeriodType;
      }
      // RC's PROMOTIONAL period maps to 'normal' in our schema — we don't
      // model promo codes separately.
      return "normal";
    })();

    // Always write the primary fields. For product_id + period_type, only
    // overwrite when the event actually provides them — otherwise preserve
    // the existing values (some events like EXPIRATION don't repeat them).
    const baseValues = {
      userId: event.app_user_id,
      entitlementKey: key,
      active: activating,
      expiresAt,
      lastEventAt: eventAt,
      updatedAt: new Date(),
    };

    if (existing) {
      await db
        .update(hyroxEntitlements)
        .set({
          ...baseValues,
          ...(event.product_id !== undefined ? { productId: event.product_id } : {}),
          ...(periodType !== null ? { periodType } : {}),
        })
        .where(eq(hyroxEntitlements.id, existing.id));
    } else {
      await db.insert(hyroxEntitlements).values({
        ...baseValues,
        productId: event.product_id ?? null,
        periodType,
      });
    }
  }

  return { applied: true };
}
