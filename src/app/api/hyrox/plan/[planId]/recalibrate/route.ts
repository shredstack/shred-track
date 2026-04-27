import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db } from "@/db";
import { hyroxTrainingPlans } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { inngest } from "@/inngest/client";

// ---------------------------------------------------------------------------
// POST — fire `hyrox/plan.recalibrate` to refresh upcoming weeks.
// ---------------------------------------------------------------------------

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { planId } = await params;

  const [plan] = await db
    .select()
    .from(hyroxTrainingPlans)
    .where(
      and(
        eq(hyroxTrainingPlans.id, planId),
        eq(hyroxTrainingPlans.userId, user.id),
      ),
    )
    .limit(1);

  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  if (plan.status !== "active") {
    return NextResponse.json(
      { error: "Plan is not active" },
      { status: 400 },
    );
  }

  if (plan.planType !== "personalized") {
    return NextResponse.json(
      { error: "Free plans don't support AI recalibration." },
      { status: 400 },
    );
  }

  await inngest.send({
    name: "hyrox/plan.recalibrate",
    data: {
      planId,
      userId: user.id,
    },
  });

  return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------
// DELETE — dismiss the recalibration suggestion without applying it.
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { planId } = await params;

  const [updated] = await db
    .update(hyroxTrainingPlans)
    .set({
      recalibrationSuggestedAt: null,
      recalibrationSourceRaceId: null,
    })
    .where(
      and(
        eq(hyroxTrainingPlans.id, planId),
        eq(hyroxTrainingPlans.userId, user.id),
      ),
    )
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
