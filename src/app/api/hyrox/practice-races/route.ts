import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db } from "@/db";
import {
  hyroxPracticeRaces,
  hyroxPracticeRaceSplits,
  hyroxStationBenchmarks,
  hyroxProfiles,
  hyroxRaceReports,
} from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { inngest } from "@/inngest/client";

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
  /** Optional discriminator for run segments. "roxzone" marks
   *  transition-simulation runs; "prescribed_run" marks 1km runs. NULL
   *  on legacy rows and on stations. See spec §4.1. */
  segmentSubtype?: "prescribed_run" | "roxzone";
  segmentLabel: string;
  timeSeconds: number;
  distanceMeters?: number;
  reps?: number;
}

const VALID_SEGMENT_SUBTYPES = new Set(["prescribed_run", "roxzone"]);

interface RacePayload {
  title?: string;
  notes?: string;
  divisionKey?: string;
  template?: string;
  raceType?: "practice" | "actual";
  planSessionId?: string;
  source?: "web" | "phone" | "watch";
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

  const raceType = body.raceType === "actual" ? "actual" : "practice";
  const totalTimeSecondsRounded = Math.round(body.totalTimeSeconds);

  // Dedup splits by segmentOrder. Older watch builds had a bug where
  // tapping Finish on the last segment appended that segment twice (see
  // RaceTimerViewModel.finish); the resulting duplicate violated the
  // UNIQUE (race_id, segment_order) constraint and 500'd the save. The
  // watch is fixed, but races already queued in PendingRaceQueue on
  // those builds carry the bad payload, so we defensively dedup here.
  const seenSegmentOrders = new Set<number>();
  const splits: SplitPayload[] = [];
  for (const s of body.splits) {
    if (seenSegmentOrders.has(s.segmentOrder)) {
      console.warn("[practice-races POST] dropping duplicate split", {
        segmentOrder: s.segmentOrder,
        segmentLabel: s.segmentLabel,
      });
      continue;
    }
    seenSegmentOrders.add(s.segmentOrder);
    splits.push(s);
  }

  console.log("[practice-races POST] start", {
    userId: user.id,
    source: body.source,
    template: body.template,
    divisionKey: body.divisionKey,
    splitsCount: splits.length,
    droppedDuplicates: body.splits.length - splits.length,
    totalTimeSeconds: body.totalTimeSeconds,
    startedAt: body.startedAt,
    completedAt: body.completedAt,
  });

  let result;
  try {
  // Use a transaction for atomicity
  result = await db.transaction(async (tx) => {
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
        raceType,
        planSessionId: body.planSessionId ?? null,
      })
      .returning();

    // 2. Insert splits
    await tx.insert(hyroxPracticeRaceSplits).values(
      splits.map((s) => ({
        raceId: race.id,
        segmentOrder: s.segmentOrder,
        segmentType: s.segmentType,
        // Drop unknown subtype values silently — the CHECK constraint
        // would reject them otherwise. Stations always store NULL.
        segmentSubtype:
          s.segmentType === "run" &&
          s.segmentSubtype &&
          VALID_SEGMENT_SUBTYPES.has(s.segmentSubtype)
            ? s.segmentSubtype
            : null,
        segmentLabel: s.segmentLabel,
        timeSeconds: s.timeSeconds.toFixed(1),
        distanceMeters: s.distanceMeters,
        reps: s.reps,
      })),
    );

    // 3. Check for personal bests on station segments + insert benchmarks
    const stationSplits = splits.filter((s) => s.segmentType === "station");
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

      // Always record the benchmark, linked to this race
      await tx.insert(hyroxStationBenchmarks).values({
        userId: user.id,
        station: split.segmentLabel,
        timeSeconds,
        source: "practice_race",
        notes: `Practice race: ${race.title}`,
        sourceRaceId: race.id,
      });

      if (isNewBest) {
        personalBests.push(split.segmentLabel);
      }
    }

    // 4. Detect overall finish-time PR (compared to profile.bestFinishTimeSeconds).
    const [profile] = await tx
      .select()
      .from(hyroxProfiles)
      .where(eq(hyroxProfiles.userId, user.id))
      .limit(1);

    const priorBestFinishSeconds = profile?.bestFinishTimeSeconds ?? null;
    // Tied times do NOT count as a PR.
    const isFinishPR =
      priorBestFinishSeconds == null ||
      totalTimeSecondsRounded < priorBestFinishSeconds;

    // 5. Pre-create a pending race report row so the GET endpoint can poll.
    await tx
      .insert(hyroxRaceReports)
      .values({
        raceId: race.id,
        userId: user.id,
        status: "pending",
      })
      .onConflictDoNothing();

    return { race, personalBests, isFinishPR, priorBestFinishSeconds };
  });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[practice-races POST] save failed", {
      userId: user.id,
      message,
      stack,
    });
    return NextResponse.json(
      { error: "Failed to save race", detail: message },
      { status: 500 },
    );
  }

  console.log("[practice-races POST] saved", {
    raceId: result.race.id,
    personalBests: result.personalBests,
  });

  // Fire Inngest event to generate the AI race report (fire-and-forget).
  // Failures here should not break the save response.
  try {
    await inngest.send({
      name: "hyrox/race.completed",
      data: {
        raceId: result.race.id,
        userId: user.id,
      },
    });
  } catch (err) {
    console.error("Failed to dispatch hyrox/race.completed event:", err);
  }

  return NextResponse.json({
    id: result.race.id,
    personalBests: result.personalBests,
    isFinishPR: result.isFinishPR,
    priorBestFinishSeconds: result.priorBestFinishSeconds,
    raceType,
  });
}
