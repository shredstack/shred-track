import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { hyroxTrainingPlans } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// GET /api/hyrox/plan — get active training plan (metadata only, no sessions)
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [plan] = await db
    .select()
    .from(hyroxTrainingPlans)
    .where(and(eq(hyroxTrainingPlans.userId, user.id), eq(hyroxTrainingPlans.status, "active")))
    .orderBy(desc(hyroxTrainingPlans.createdAt))
    .limit(1);

  if (!plan) {
    return NextResponse.json(null);
  }

  return NextResponse.json(plan);
}

// POST /api/hyrox/plan — generate a new training plan
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { planType, startDate, totalWeeks, title, paceScaleFactor } = body;

  if (!planType || !startDate || !totalWeeks) {
    return NextResponse.json(
      { error: "planType, startDate, and totalWeeks are required" },
      { status: 400 }
    );
  }

  // Deactivate any existing active plan
  await db
    .update(hyroxTrainingPlans)
    .set({ status: "archived" })
    .where(and(eq(hyroxTrainingPlans.userId, user.id), eq(hyroxTrainingPlans.status, "active")));

  // Calculate end date
  const start = new Date(startDate);
  const end = new Date(start);
  end.setDate(end.getDate() + totalWeeks * 7 - 1);

  const [plan] = await db
    .insert(hyroxTrainingPlans)
    .values({
      userId: user.id,
      title: title || `${planType} Plan`,
      totalWeeks,
      startDate,
      endDate: end.toISOString().split("T")[0],
      planType,
      status: "active",
      paceScaleFactor: paceScaleFactor ?? "1.0",
    })
    .returning();

  return NextResponse.json(plan, { status: 201 });
}
