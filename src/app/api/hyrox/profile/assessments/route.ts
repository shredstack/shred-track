import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { hyroxProfiles, hyroxStationAssessments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";

// PUT /api/hyrox/profile/assessments — upsert station assessments
export async function PUT(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [profile] = await db
    .select()
    .from(hyroxProfiles)
    .where(eq(hyroxProfiles.userId, user.id))
    .limit(1);

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const { assessments } = await req.json();

  if (!Array.isArray(assessments) || assessments.length === 0) {
    return NextResponse.json({ error: "assessments array is required" }, { status: 400 });
  }

  // Delete existing and insert fresh
  await db.transaction(async (tx) => {
    await tx
      .delete(hyroxStationAssessments)
      .where(eq(hyroxStationAssessments.profileId, profile.id));

    await tx.insert(hyroxStationAssessments).values(
      assessments.map((a: { station: string; completionConfidence: number; currentTimeSeconds: number; goalTimeSeconds: number }) => ({
        profileId: profile.id,
        station: a.station,
        completionConfidence: a.completionConfidence,
        currentTimeSeconds: a.currentTimeSeconds,
        goalTimeSeconds: a.goalTimeSeconds,
      }))
    );
  });

  return NextResponse.json({ ok: true });
}
