import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  hyroxTrainingPlans,
  hyroxProfiles,
  hyroxStationAssessments,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { inngest } from "@/inngest/client";
import type { AthleteSnapshot } from "@/types/hyrox-plan";

// POST /api/hyrox/plan/generate — kick off AI plan generation
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Load profile + assessments
  const [profile] = await db
    .select()
    .from(hyroxProfiles)
    .where(eq(hyroxProfiles.userId, user.id))
    .limit(1);

  if (!profile) {
    return NextResponse.json(
      { error: "Complete HYROX onboarding first" },
      { status: 400 }
    );
  }

  const assessments = await db
    .select()
    .from(hyroxStationAssessments)
    .where(eq(hyroxStationAssessments.profileId, profile.id));

  // Build athlete snapshot
  const snapshot: AthleteSnapshot = {
    name: user.name,
    gender: profile.targetDivision.startsWith("women") ? "women" : "men",
    unit: "mixed",
    division: profile.targetDivision as AthleteSnapshot["division"],
    raceDate: profile.nextRaceDate,
    goalFinishTimeSeconds: profile.goalFinishTimeSeconds,
    easyPaceSecondsPerUnit: profile.easyPaceSecondsPerUnit ?? 0,
    moderatePaceSecondsPerUnit: profile.moderatePaceSecondsPerUnit ?? 0,
    fastPaceSecondsPerUnit: profile.fastPaceSecondsPerUnit ?? 0,
    paceUnit: profile.paceUnit,
    hasExperience: (profile.previousRaceCount ?? 0) > 0,
    previousRaceCount: profile.previousRaceCount ?? 0,
    bestFinishTimeSeconds: profile.bestFinishTimeSeconds,
    bestDivision: (profile.bestDivision as AthleteSnapshot["bestDivision"]) ?? null,
    bestTimeNotes: profile.bestTimeNotes ?? null,
    crossfitDaysPerWeek: profile.crossfitDaysPerWeek ?? 5,
    crossfitGymName: profile.crossfitGymName,
    availableEquipment: profile.availableEquipment ?? [],
    injuriesNotes: profile.injuriesNotes,
    trainingPhilosophy: profile.trainingPhilosophy ?? "moderate",
    stationAssessments: assessments.map((a) => ({
      station: a.station,
      completionConfidence: a.completionConfidence,
      currentTimeSeconds: a.currentTimeSeconds,
      goalTimeSeconds: a.goalTimeSeconds,
    })),
  };

  // Calculate plan dates
  const startDate = new Date().toISOString().split("T")[0];
  const totalWeeks = profile.nextRaceDate
    ? Math.max(4, Math.min(24, Math.ceil((new Date(profile.nextRaceDate).getTime() - Date.now()) / (7 * 24 * 60 * 60 * 1000))))
    : 12;
  const endDate = new Date(Date.now() + totalWeeks * 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  // Archive existing active plans
  await db
    .update(hyroxTrainingPlans)
    .set({ status: "archived" })
    .where(
      and(
        eq(hyroxTrainingPlans.userId, user.id),
        eq(hyroxTrainingPlans.status, "active")
      )
    );

  // Create plan record
  const [plan] = await db
    .insert(hyroxTrainingPlans)
    .values({
      userId: user.id,
      title: "Generating plan...",
      totalWeeks,
      startDate,
      endDate,
      planType: "ai_generated",
      status: "active",
      paceScaleFactor: "1.0",
      generationStatus: "pending",
      aiModel: process.env.HYROX_TEST_MODE === "true" ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-6",
      athleteSnapshot: snapshot,
    })
    .returning();

  // Fire Inngest event
  await inngest.send({
    name: "hyrox/plan.requested",
    data: {
      planId: plan.id,
      snapshot,
    },
  });

  return NextResponse.json(
    { planId: plan.id, generationStatus: "pending" },
    { status: 202 }
  );
}
