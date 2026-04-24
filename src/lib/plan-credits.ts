// ---------------------------------------------------------------------------
// Plan credits — pay-per-generation + VIP allowance.
//
// Each personalized plan generation consumes one "credit" from the highest-
// priority source available at gate time:
//   1. Bypass      — HYROX_PAYWALL_ENFORCED=false, dev mode.
//   2. VIP         — user has an active hyrox_vip_grants row AND has used
//                    fewer than plans_per_year in the trailing 365 days.
//   3. Purchase    — user has an unconsumed row in hyrox_plan_purchases.
//
// If none apply, the gate returns `{ allowed: false, reason: 'payment_required' }`
// and the caller is expected to 402 with checkout UX.
//
// Consumption is recorded in hyrox_plan_generations with:
//   - source = 'vip' | 'purchase' | 'bypass'
//   - purchase_id = the consumed purchase row (only for 'purchase')
//
// Gotcha: `consumeCredit()` wraps the check+insert in a DB transaction with
// a SELECT ... FOR UPDATE on the next available purchase row to prevent
// double-spend if the user fires two generation requests concurrently.
// ---------------------------------------------------------------------------

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  hyroxPlanGenerations,
  hyroxPlanPurchases,
  hyroxVipGrants,
} from "@/db/schema";
import { isPaywallEnforced } from "@/lib/entitlements";

/** Price we charge per plan, in minor currency units. Single source of truth. */
export const PERSONALIZED_PLAN_PRICE_CENTS = 999;
export const PERSONALIZED_PLAN_PRICE_USD = "9.99";

export type CreditSource = "vip" | "purchase" | "bypass";

export interface CreditStatus {
  /** True if the user can start a generation right now (no purchase needed). */
  canGenerate: boolean;
  /** Which source the NEXT generation would draw from, if any. */
  nextSource: CreditSource | null;
  paywallEnforced: boolean;
  purchases: {
    total: number;
    consumed: number;
    remaining: number;
  };
  vip: {
    isVip: boolean;
    plansPerYear: number | null;
    usedThisYear: number;
    remaining: number;
  };
}

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** Read-only snapshot of the user's credit state. Safe to call anywhere. */
export async function getCreditStatus(userId: string): Promise<CreditStatus> {
  const paywall = isPaywallEnforced();

  const [vipRow] = await db
    .select()
    .from(hyroxVipGrants)
    .where(and(eq(hyroxVipGrants.userId, userId), eq(hyroxVipGrants.active, true)))
    .limit(1);

  const oneYearAgo = new Date(Date.now() - ONE_YEAR_MS);
  const vipUsedResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(hyroxPlanGenerations)
    .where(
      and(
        eq(hyroxPlanGenerations.userId, userId),
        eq(hyroxPlanGenerations.source, "vip"),
        gte(hyroxPlanGenerations.createdAt, oneYearAgo),
      ),
    );
  const vipUsed = vipUsedResult[0]?.count ?? 0;
  const vipAllowance = vipRow?.plansPerYear ?? 0;
  const vipRemaining = vipRow ? Math.max(0, vipAllowance - vipUsed) : 0;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(hyroxPlanPurchases)
    .where(eq(hyroxPlanPurchases.userId, userId));

  const [{ consumed }] = await db
    .select({ consumed: sql<number>`count(*)::int` })
    .from(hyroxPlanGenerations)
    .where(
      and(
        eq(hyroxPlanGenerations.userId, userId),
        eq(hyroxPlanGenerations.source, "purchase"),
      ),
    );
  const purchaseRemaining = Math.max(0, total - consumed);

  let nextSource: CreditSource | null = null;
  if (!paywall) nextSource = "bypass";
  else if (vipRow && vipRemaining > 0) nextSource = "vip";
  else if (purchaseRemaining > 0) nextSource = "purchase";

  return {
    canGenerate: nextSource !== null,
    nextSource,
    paywallEnforced: paywall,
    purchases: { total, consumed, remaining: purchaseRemaining },
    vip: {
      isVip: !!vipRow,
      plansPerYear: vipRow ? vipAllowance : null,
      usedThisYear: vipUsed,
      remaining: vipRemaining,
    },
  };
}

export interface ConsumeResult {
  allowed: true;
  source: CreditSource;
  generationId: string;
}

export interface ConsumeDenied {
  allowed: false;
  reason: "payment_required";
}

/**
 * Consume one credit for the given user and return the generation ledger id
 * so the caller can back-link it to the plan row it creates.
 *
 * The caller is responsible for calling linkGenerationToPlan() after the
 * hyrox_training_plans row is inserted — we don't do it in one txn because
 * plan creation happens in a different module and may take longer than we
 * want to hold a row lock.
 */
export async function consumeCredit(
  userId: string,
): Promise<ConsumeResult | ConsumeDenied> {
  if (!isPaywallEnforced()) {
    const [row] = await db
      .insert(hyroxPlanGenerations)
      .values({ userId, source: "bypass" })
      .returning({ id: hyroxPlanGenerations.id });
    return { allowed: true, source: "bypass", generationId: row.id };
  }

  return db.transaction(async (tx) => {
    // VIP first — no purchase decrement needed, just record usage.
    const [vipRow] = await tx
      .select()
      .from(hyroxVipGrants)
      .where(and(eq(hyroxVipGrants.userId, userId), eq(hyroxVipGrants.active, true)))
      .limit(1);

    if (vipRow) {
      const oneYearAgo = new Date(Date.now() - ONE_YEAR_MS);
      const [{ used }] = await tx
        .select({ used: sql<number>`count(*)::int` })
        .from(hyroxPlanGenerations)
        .where(
          and(
            eq(hyroxPlanGenerations.userId, userId),
            eq(hyroxPlanGenerations.source, "vip"),
            gte(hyroxPlanGenerations.createdAt, oneYearAgo),
          ),
        );
      if (used < vipRow.plansPerYear) {
        const [row] = await tx
          .insert(hyroxPlanGenerations)
          .values({ userId, source: "vip" })
          .returning({ id: hyroxPlanGenerations.id });
        return { allowed: true, source: "vip", generationId: row.id };
      }
    }

    // Purchase — lock the oldest unconsumed purchase so concurrent
    // generations can't double-spend it. `purchase_id` has a UNIQUE
    // constraint in hyrox_plan_generations as a belt-and-braces guard.
    const candidate = await tx.execute<{ id: string }>(sql`
      SELECT p.id
      FROM hyrox_plan_purchases p
      WHERE p.user_id = ${userId}
        AND NOT EXISTS (
          SELECT 1 FROM hyrox_plan_generations g
          WHERE g.purchase_id = p.id
        )
      ORDER BY p.purchased_at ASC
      LIMIT 1
      FOR UPDATE OF p SKIP LOCKED
    `);
    const purchaseId = candidate[0]?.id;

    if (purchaseId) {
      const [row] = await tx
        .insert(hyroxPlanGenerations)
        .values({ userId, source: "purchase", purchaseId })
        .returning({ id: hyroxPlanGenerations.id });
      return { allowed: true, source: "purchase", generationId: row.id };
    }

    return { allowed: false, reason: "payment_required" };
  });
}

/** Back-link the generation ledger row to the newly-created plan row. */
export async function linkGenerationToPlan(
  generationId: string,
  planId: string,
): Promise<void> {
  await db
    .update(hyroxPlanGenerations)
    .set({ planId })
    .where(eq(hyroxPlanGenerations.id, generationId));
}

/**
 * Refund a generation if plan creation fails downstream. Deletes the ledger
 * row so the purchase becomes consumable again (or the VIP count drops back).
 */
export async function refundGeneration(generationId: string): Promise<void> {
  await db.delete(hyroxPlanGenerations).where(eq(hyroxPlanGenerations.id, generationId));
}

// ---------------------------------------------------------------------------
// Purchase ingestion — called from the RC webhook.
// ---------------------------------------------------------------------------

export interface GrantPurchaseInput {
  userId: string;
  rcEventId: string;
  rcTransactionId?: string | null;
  productId?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  purchasedAt: Date;
}

/**
 * Idempotent purchase credit. rc_event_id is unique — if RC redelivers the
 * same event, we detect the conflict and no-op.
 */
export async function grantPurchaseCredit(
  input: GrantPurchaseInput,
): Promise<{ granted: boolean; reason?: string }> {
  try {
    await db.insert(hyroxPlanPurchases).values({
      userId: input.userId,
      rcEventId: input.rcEventId,
      rcTransactionId: input.rcTransactionId ?? null,
      productId: input.productId ?? null,
      amountCents: input.amountCents ?? null,
      currency: input.currency ?? null,
      purchasedAt: input.purchasedAt,
    });
    return { granted: true };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      return { granted: false, reason: "duplicate rc_event_id" };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// VIP admin controls — used by /api/admin/hyrox/vip.
// ---------------------------------------------------------------------------

export interface VipGrantView {
  userId: string;
  plansPerYear: number;
  active: boolean;
  grantedBy: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function upsertVipGrant(params: {
  userId: string;
  plansPerYear: number;
  grantedBy: string;
  notes?: string | null;
}): Promise<VipGrantView> {
  const [existing] = await db
    .select()
    .from(hyroxVipGrants)
    .where(eq(hyroxVipGrants.userId, params.userId))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(hyroxVipGrants)
      .set({
        plansPerYear: params.plansPerYear,
        active: true,
        grantedBy: params.grantedBy,
        notes: params.notes ?? existing.notes,
        updatedAt: new Date(),
      })
      .where(eq(hyroxVipGrants.userId, params.userId))
      .returning();
    return updated as VipGrantView;
  }

  const [inserted] = await db
    .insert(hyroxVipGrants)
    .values({
      userId: params.userId,
      plansPerYear: params.plansPerYear,
      active: true,
      grantedBy: params.grantedBy,
      notes: params.notes ?? null,
    })
    .returning();
  return inserted as VipGrantView;
}

export async function revokeVipGrant(userId: string): Promise<void> {
  await db
    .update(hyroxVipGrants)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(hyroxVipGrants.userId, userId));
}

export async function listVipGrants(): Promise<VipGrantView[]> {
  const rows = await db
    .select()
    .from(hyroxVipGrants)
    .orderBy(desc(hyroxVipGrants.updatedAt));
  return rows as VipGrantView[];
}
