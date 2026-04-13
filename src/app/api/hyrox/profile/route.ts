import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { hyroxProfiles, hyroxStationAssessments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// GET /api/hyrox/profile — get user's HYROX profile
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [profile] = await db
    .select()
    .from(hyroxProfiles)
    .where(eq(hyroxProfiles.userId, user.id))
    .limit(1);

  if (!profile) {
    return NextResponse.json(null);
  }

  const assessments = await db
    .select()
    .from(hyroxStationAssessments)
    .where(eq(hyroxStationAssessments.profileId, profile.id));

  return NextResponse.json({ ...profile, assessments });
}

// POST /api/hyrox/profile — create HYROX profile
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { targetDivision } = body;

  if (!targetDivision) {
    return NextResponse.json({ error: "targetDivision is required" }, { status: 400 });
  }

  try {
    const [profile] = await db
      .insert(hyroxProfiles)
      .values({
        userId: user.id,
        name: body.name || null,
        gender: body.gender || null,
        preferredUnits: body.preferredUnits || "metric",
        targetDivision,
        nextRaceDate: body.nextRaceDate || null,
        easyPaceSecondsPerUnit: body.easyPaceSecondsPerUnit || null,
        moderatePaceSecondsPerUnit: body.moderatePaceSecondsPerUnit || null,
        fastPaceSecondsPerUnit: body.fastPaceSecondsPerUnit || null,
        recent5kTimeSeconds: body.recent5kTimeSeconds || null,
        recent800mRepeatSeconds: body.recent800mRepeatSeconds || null,
        paceUnit: body.paceUnit || "mile",
        previousRaceCount: body.previousRaceCount ?? 0,
        bestFinishTimeSeconds: body.bestFinishTimeSeconds || null,
        bestDivision: body.bestDivision || null,
        bestTimeNotes: body.bestTimeNotes || null,
        goalFinishTimeSeconds: body.goalFinishTimeSeconds || null,
        crossfitDaysPerWeek: body.crossfitDaysPerWeek ?? 5,
        crossfitGymName: body.crossfitGymName || null,
        availableEquipment: body.availableEquipment || [],
        injuriesNotes: body.injuriesNotes || null,
        trainingPhilosophy: body.trainingPhilosophy || "moderate",
        onboardingVersion: 2,
      })
      .returning();

    return NextResponse.json(profile, { status: 201 });
  } catch (err: unknown) {
    // The postgres driver wraps constraint errors — check both the message
    // and the underlying cause for duplicate-key indicators.
    const message = err instanceof Error ? err.message : "";
    const causeCode = err instanceof Error && err.cause && typeof err.cause === "object" && "code" in err.cause
      ? (err.cause as { code?: string }).code
      : undefined;
    if (message.includes("unique") || message.includes("duplicate") || causeCode === "23505") {
      return NextResponse.json({ error: "HYROX profile already exists" }, { status: 409 });
    }
    throw err;
  }
}

// PUT /api/hyrox/profile — update HYROX profile
export async function PUT(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();

  const [existing] = await db
    .select()
    .from(hyroxProfiles)
    .where(eq(hyroxProfiles.userId, user.id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Profile not found. Create one first." }, { status: 404 });
  }

  const [updated] = await db
    .update(hyroxProfiles)
    .set({
      name: body.name ?? existing.name,
      gender: body.gender ?? existing.gender,
      preferredUnits: body.preferredUnits ?? existing.preferredUnits,
      targetDivision: body.targetDivision ?? existing.targetDivision,
      nextRaceDate: body.nextRaceDate ?? existing.nextRaceDate,
      easyPaceSecondsPerUnit: body.easyPaceSecondsPerUnit ?? existing.easyPaceSecondsPerUnit,
      moderatePaceSecondsPerUnit: body.moderatePaceSecondsPerUnit ?? existing.moderatePaceSecondsPerUnit,
      fastPaceSecondsPerUnit: body.fastPaceSecondsPerUnit ?? existing.fastPaceSecondsPerUnit,
      recent5kTimeSeconds: body.recent5kTimeSeconds ?? existing.recent5kTimeSeconds,
      recent800mRepeatSeconds: body.recent800mRepeatSeconds ?? existing.recent800mRepeatSeconds,
      paceUnit: body.paceUnit ?? existing.paceUnit,
      previousRaceCount: body.previousRaceCount ?? existing.previousRaceCount,
      bestFinishTimeSeconds: body.bestFinishTimeSeconds ?? existing.bestFinishTimeSeconds,
      bestDivision: body.bestDivision ?? existing.bestDivision,
      bestTimeNotes: body.bestTimeNotes ?? existing.bestTimeNotes,
      goalFinishTimeSeconds: body.goalFinishTimeSeconds ?? existing.goalFinishTimeSeconds,
      crossfitDaysPerWeek: body.crossfitDaysPerWeek ?? existing.crossfitDaysPerWeek,
      crossfitGymName: body.crossfitGymName ?? existing.crossfitGymName,
      availableEquipment: body.availableEquipment ?? existing.availableEquipment,
      injuriesNotes: body.injuriesNotes ?? existing.injuriesNotes,
      trainingPhilosophy: body.trainingPhilosophy ?? existing.trainingPhilosophy,
      onboardingVersion: 2,
      updatedAt: new Date(),
    })
    .where(eq(hyroxProfiles.userId, user.id))
    .returning();

  return NextResponse.json(updated);
}
