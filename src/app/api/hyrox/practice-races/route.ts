import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db } from "@/db";
import {
  hyroxPracticeRaces,
  hyroxPracticeRaceSplits,
  hyroxStationBenchmarks,
} from "@/db/schema";
import { eq, desc } from "drizzle-orm";

// ---------------------------------------------------------------------------
// GET — list user's practice races
// ---------------------------------------------------------------------------

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const races = await db
    .select()
    .from(hyroxPracticeRaces)
    .where(eq(hyroxPracticeRaces.userId, user.id))
    .orderBy(desc(hyroxPracticeRaces.createdAt));

  return NextResponse.json(races);
}

// ---------------------------------------------------------------------------
// POST — save a completed practice race
// ---------------------------------------------------------------------------

interface SplitPayload {
  segmentOrder: number;
  segmentType: "run" | "station";
  segmentLabel: string;
  timeSeconds: number;
  distanceMeters?: number;
  reps?: number;
}

interface RacePayload {
  title?: string;
  notes?: string;
  divisionKey?: string;
  template?: string;
  totalTimeSeconds: number;
  startedAt: string;
  completedAt: string;
  splits: SplitPayload[];
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as RacePayload;

  if (!body.totalTimeSeconds || !body.splits?.length) {
    return NextResponse.json(
      { error: "Missing required fields: totalTimeSeconds, splits" },
      { status: 400 },
    );
  }

  // Use a transaction for atomicity
  const result = await db.transaction(async (tx) => {
    // 1. Insert the race
    const [race] = await tx
      .insert(hyroxPracticeRaces)
      .values({
        userId: user.id,
        title: body.title || "Practice Race",
        divisionKey: body.divisionKey,
        template: body.template ?? "full",
        totalTimeSeconds: body.totalTimeSeconds.toFixed(1),
        startedAt: new Date(body.startedAt),
        completedAt: new Date(body.completedAt),
        notes: body.notes,
      })
      .returning();

    // 2. Insert splits
    await tx.insert(hyroxPracticeRaceSplits).values(
      body.splits.map((s) => ({
        raceId: race.id,
        segmentOrder: s.segmentOrder,
        segmentType: s.segmentType,
        segmentLabel: s.segmentLabel,
        timeSeconds: s.timeSeconds.toFixed(1),
        distanceMeters: s.distanceMeters,
        reps: s.reps,
      })),
    );

    // 3. Check for personal bests on station segments
    const stationSplits = body.splits.filter((s) => s.segmentType === "station");
    const personalBests: string[] = [];

    for (const split of stationSplits) {
      const timeSeconds = Math.round(split.timeSeconds);

      // Get the current best for this station
      const existing = await tx
        .select()
        .from(hyroxStationBenchmarks)
        .where(eq(hyroxStationBenchmarks.userId, user.id))
        .orderBy(desc(hyroxStationBenchmarks.loggedAt));

      const currentBest = existing.find(
        (b) => b.station === split.segmentLabel,
      );

      const isNewBest = !currentBest || timeSeconds < currentBest.timeSeconds;

      // Always record the benchmark
      await tx.insert(hyroxStationBenchmarks).values({
        userId: user.id,
        station: split.segmentLabel,
        timeSeconds,
        source: "practice_race",
        notes: `Practice race: ${race.title}`,
      });

      if (isNewBest) {
        personalBests.push(split.segmentLabel);
      }
    }

    return { race, personalBests };
  });

  return NextResponse.json({
    id: result.race.id,
    personalBests: result.personalBests,
  });
}
