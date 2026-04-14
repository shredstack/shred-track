import { NextResponse } from "next/server";
import { db } from "@/db";
import { hyroxTrainingPlans } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// GET /api/hyrox/plan/history — list all plans (active + archived)
export async function GET() {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plans = await db
    .select({
      id: hyroxTrainingPlans.id,
      title: hyroxTrainingPlans.title,
      status: hyroxTrainingPlans.status,
      totalWeeks: hyroxTrainingPlans.totalWeeks,
      startDate: hyroxTrainingPlans.startDate,
      endDate: hyroxTrainingPlans.endDate,
      generationStatus: hyroxTrainingPlans.generationStatus,
      createdAt: hyroxTrainingPlans.createdAt,
    })
    .from(hyroxTrainingPlans)
    .where(eq(hyroxTrainingPlans.userId, user.id))
    .orderBy(desc(hyroxTrainingPlans.createdAt));

  return NextResponse.json(plans);
}
