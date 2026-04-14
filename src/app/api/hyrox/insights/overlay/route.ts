import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db } from "@/db";
import { hyroxProfiles, hyroxStationBenchmarks, hyroxStationAssessments } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { STATION_ORDER } from "@/lib/hyrox-data";
import { divisionSchema } from "@/lib/insights/validation";

/**
 * Returns the user's own times formatted for overlaying on the Pace Profile chart.
 * Combines latest station benchmarks + run paces from profile.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const divisionResult = divisionSchema.safeParse(params.get("division"));
  if (!divisionResult.success) {
    return NextResponse.json({ error: "Invalid division" }, { status: 400 });
  }

  // Get profile for run paces
  const [profile] = await db
    .select()
    .from(hyroxProfiles)
    .where(eq(hyroxProfiles.userId, user.id));

  // Get latest benchmark per station
  const benchmarks = await db
    .select()
    .from(hyroxStationBenchmarks)
    .where(eq(hyroxStationBenchmarks.userId, user.id))
    .orderBy(desc(hyroxStationBenchmarks.loggedAt));

  // Get station assessments (fallback for times)
  const assessments = profile
    ? await db
        .select()
        .from(hyroxStationAssessments)
        .where(eq(hyroxStationAssessments.profileId, profile.id))
    : [];

  // Build overlay data
  const segments: Array<{ segmentLabel: string; timeSeconds: number }> = [];

  // Latest benchmark per station (use the most recent one)
  const latestBenchmark = new Map<string, number>();
  for (const b of benchmarks) {
    if (!latestBenchmark.has(b.station)) {
      latestBenchmark.set(b.station, b.timeSeconds);
    }
  }

  // Assessment times as fallback
  const assessmentTimes = new Map<string, number>();
  for (const a of assessments) {
    if (a.currentTimeSeconds) {
      assessmentTimes.set(a.station, a.currentTimeSeconds);
    }
  }

  // Add station times
  for (const station of STATION_ORDER) {
    const time = latestBenchmark.get(station) ?? assessmentTimes.get(station);
    if (time) {
      segments.push({ segmentLabel: station, timeSeconds: time });
    }
  }

  // Add run times from profile paces (moderate pace × 1km)
  if (profile?.moderatePaceSecondsPerUnit) {
    // Convert pace per unit to seconds per km
    let secsPerKm = profile.moderatePaceSecondsPerUnit;
    if (profile.paceUnit === "mile") {
      secsPerKm = Math.round(profile.moderatePaceSecondsPerUnit / 1.60934);
    }
    for (let i = 1; i <= 8; i++) {
      segments.push({ segmentLabel: `Run ${i}`, timeSeconds: secsPerKm });
    }
  }

  return NextResponse.json(segments);
}
