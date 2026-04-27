import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db } from "@/db";
import {
  hyroxTrainingPlans,
  hyroxPracticeRaces,
  hyroxRaceReports,
} from "@/db/schema";
import { and, desc, eq, isNotNull } from "drizzle-orm";

// ---------------------------------------------------------------------------
// GET — has-suggestion check for the recalibration banner.
//
// Returns the most recent suggestion across the user's active plans.
// Empty (`hasSuggestion: false`) when there's nothing to suggest.
// ---------------------------------------------------------------------------

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [plan] = await db
    .select()
    .from(hyroxTrainingPlans)
    .where(
      and(
        eq(hyroxTrainingPlans.userId, user.id),
        eq(hyroxTrainingPlans.status, "active"),
        isNotNull(hyroxTrainingPlans.recalibrationSuggestedAt),
      ),
    )
    .orderBy(desc(hyroxTrainingPlans.recalibrationSuggestedAt))
    .limit(1);

  if (!plan || !plan.recalibrationSourceRaceId) {
    return NextResponse.json({
      hasSuggestion: false,
      planId: null,
      raceId: null,
      raceTitle: null,
      topStations: [],
      weeksRemaining: null,
    });
  }

  // Look up the source race for title display.
  const [race] = await db
    .select({
      id: hyroxPracticeRaces.id,
      title: hyroxPracticeRaces.title,
    })
    .from(hyroxPracticeRaces)
    .where(eq(hyroxPracticeRaces.id, plan.recalibrationSourceRaceId))
    .limit(1);

  // Pull top stations from the report (if it completed).
  const [report] = await db
    .select()
    .from(hyroxRaceReports)
    .where(eq(hyroxRaceReports.raceId, plan.recalibrationSourceRaceId))
    .limit(1);

  const topStations =
    (report?.timeLossRanking as { station: string }[] | null)
      ?.map((r) => r.station)
      .slice(0, 2) ?? [];

  // Weeks remaining is best-effort — endDate is a date string.
  const endDate = new Date(plan.endDate);
  const today = new Date();
  const weeksRemaining = Math.max(
    0,
    Math.floor(
      (endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24 * 7),
    ),
  );

  return NextResponse.json({
    hasSuggestion: true,
    planId: plan.id,
    raceId: plan.recalibrationSourceRaceId,
    raceTitle: race?.title ?? null,
    topStations,
    weeksRemaining,
  });
}
