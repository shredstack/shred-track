import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { hyroxTrainingPlans } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// GET /api/hyrox/plan/[planId]/status — poll generation status
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { planId } = await params;

  const [plan] = await db
    .select({
      id: hyroxTrainingPlans.id,
      title: hyroxTrainingPlans.title,
      generationStatus: hyroxTrainingPlans.generationStatus,
      totalWeeks: hyroxTrainingPlans.totalWeeks,
    })
    .from(hyroxTrainingPlans)
    .where(
      and(
        eq(hyroxTrainingPlans.id, planId),
        eq(hyroxTrainingPlans.userId, user.id)
      )
    )
    .limit(1);

  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  return NextResponse.json(plan);
}
