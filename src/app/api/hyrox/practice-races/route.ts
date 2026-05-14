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
import { eq, desc, and } from "drizzle-orm";
import { inngest } from "@/inngest/client";
import {
  isCanonicalAttempt,
  normalizeStationPaceSeconds,
  STATION_PACE_TYPE,
  type DivisionKey,
} from "@/lib/hyrox-data";

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
  weightKg?: number;
  weightLabel?: string;
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
  /** Client-supplied id shared between phone + watch for the same
   *  race. When present, dedups against an existing row scoped to
   *  this user — a duplicate POST is an idempotent no-op. */
  raceId?: string;
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

  const clientRaceId =
    typeof body.raceId === "string" && body.raceId.length > 0
      ? body.raceId
      : null;

  let result;
  try {
  // Use a transaction for atomicity
  result = await db.transaction(async (tx) => {
    // Idempotency check: if the client supplied a raceId and a row
    // already exists for (userId, clientRaceId), return it without
    // re-inserting splits or recomputing benchmarks. The partial
    // UNIQUE index on (user_id, client_race_id) WHERE NOT NULL is the
    // safety net for the genuinely-concurrent insert race — the
    // second tx hits the constraint and throws, which the outer
    // handler re-reads below.
    if (clientRaceId) {
      const [existing] = await tx
        .select({ id: hyroxPracticeRaces.id })
        .from(hyroxPracticeRaces)
        .where(
          and(
            eq(hyroxPracticeRaces.userId, user.id),
            eq(hyroxPracticeRaces.clientRaceId, clientRaceId),
          ),
        )
        .limit(1);

      if (existing) {
        console.log("[practice-races POST] dedup hit", {
          userId: user.id,
          clientRaceId,
          existingRaceId: existing.id,
        });
        return {
          race: { id: existing.id, title: body.title || "Practice Race" },
          personalBests: [] as string[],
          isFinishPR: false,
          priorBestFinishSeconds: null as number | null,
          dedupHit: true,
        };
      }
    }

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
        clientRaceId,
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
        weightKg:
          typeof s.weightKg === "number" ? s.weightKg.toString() : null,
        weightLabel: s.weightLabel ?? null,
      })),
    );

    // 3. Check for personal bests on station segments + insert benchmarks
    const stationSplits = splits.filter((s) => s.segmentType === "station");
    const personalBests: string[] = [];
    const divisionKeyTyped =
      (body.divisionKey as DivisionKey | undefined) ?? null;

    // Pull existing benchmarks once for this user; we'll filter per station.
    const allExisting = await tx
      .select()
      .from(hyroxStationBenchmarks)
      .where(eq(hyroxStationBenchmarks.userId, user.id))
      .orderBy(desc(hyroxStationBenchmarks.loggedAt));

    for (const split of stationSplits) {
      const timeSeconds = Math.round(split.timeSeconds);
      const stationName = split.segmentLabel;
      const eligibleForPR = isCanonicalAttempt(
        stationName,
        divisionKeyTyped,
        split.distanceMeters ?? null,
        split.reps ?? null,
        split.weightKg ?? null,
      );

      // Always record the benchmark, linked to this race. Non-canonical
      // attempts still get stored so the athlete sees a full history;
      // they just can't displace a canonical PR.
      await tx.insert(hyroxStationBenchmarks).values({
        userId: user.id,
        station: stationName,
        timeSeconds,
        distanceMeters: split.distanceMeters ?? null,
        reps: split.reps ?? null,
        weightKg:
          typeof split.weightKg === "number"
            ? split.weightKg.toString()
            : null,
        weightLabel: split.weightLabel ?? null,
        source: "practice_race",
        notes: `Practice race: ${race.title}`,
        sourceRaceId: race.id,
      });

      if (!eligibleForPR) continue;

      // Compare against prior canonical attempts only. Legacy rows
      // (NULL distance/reps/weight) are treated as canonical by
      // isCanonicalAttempt, so they participate.
      const priorCanonical = allExisting.filter(
        (b) =>
          b.station === stationName &&
          isCanonicalAttempt(
            stationName,
            divisionKeyTyped,
            b.distanceMeters,
            b.reps,
            b.weightKg != null ? Number(b.weightKg) : null,
          ),
      );

      const paceType = STATION_PACE_TYPE[stationName] ?? "total";
      let isNewBest = priorCanonical.length === 0;

      if (!isNewBest) {
        if (paceType === "per500m" || paceType === "perRep") {
          const newNorm = normalizeStationPaceSeconds(
            stationName,
            timeSeconds,
            split.distanceMeters ?? null,
            split.reps ?? null,
          );
          if (newNorm == null) {
            // Fall back to raw time if we can't normalize (e.g. missing
            // distance/reps on this attempt).
            isNewBest = priorCanonical.every(
              (b) => timeSeconds < b.timeSeconds,
            );
          } else {
            isNewBest = priorCanonical.every((b) => {
              const bNorm = normalizeStationPaceSeconds(
                stationName,
                b.timeSeconds,
                b.distanceMeters,
                b.reps,
              );
              // Treat unnormalizable priors as canonical-distance — use
              // raw time. Legacy rows fall through this path.
              if (bNorm == null) return timeSeconds < b.timeSeconds;
              return newNorm < bNorm;
            });
          }
        } else {
          // "total" type — compare apples-to-apples raw time across
          // prior canonical attempts.
          isNewBest = priorCanonical.every(
            (b) => timeSeconds < b.timeSeconds,
          );
        }
      }

      if (isNewBest) {
        personalBests.push(stationName);
      }
    }

    // 4. Detect overall finish-time PR (compared to profile.bestFinishTimeSeconds).
    const [profile] = await tx
      .select()
      .from(hyroxProfiles)
      .where(eq(hyroxProfiles.userId, user.id))
      .limit(1);

    const priorBestFinishSeconds = profile?.bestFinishTimeSeconds ?? null;
    // Tied times do NOT count as a PR. Only canonical Full-format races
    // are eligible — Half is too short and Custom may have dropped
    // stations or shortened distances, so neither should displace a
    // real HYROX best.
    const finishTemplate = body.template ?? "full";
    const isFinishPR =
      finishTemplate === "full" &&
      (priorBestFinishSeconds == null ||
        totalTimeSecondsRounded < priorBestFinishSeconds);

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
    // Concurrent-insert race against the partial UNIQUE index on
    // (user_id, client_race_id). The pre-check inside the tx caught
    // 99% of cases; this is the safety net for the microsecond window
    // where two transactions both pre-check empty before either
    // commits. Postgres throws 23505; re-read and return the winner.
    const code = (err as { code?: unknown })?.code;
    if (code === "23505" && clientRaceId) {
      try {
        const [existing] = await db
          .select({ id: hyroxPracticeRaces.id })
          .from(hyroxPracticeRaces)
          .where(
            and(
              eq(hyroxPracticeRaces.userId, user.id),
              eq(hyroxPracticeRaces.clientRaceId, clientRaceId),
            ),
          )
          .limit(1);
        if (existing) {
          console.log("[practice-races POST] dedup hit via unique-violation", {
            userId: user.id,
            clientRaceId,
            existingRaceId: existing.id,
          });
          return NextResponse.json({
            id: existing.id,
            personalBests: [] as string[],
            isFinishPR: false,
            priorBestFinishSeconds: null,
            raceType,
          });
        }
      } catch {
        // fall through to 500 below
      }
    }
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
    dedupHit: result.dedupHit ?? false,
  });

  // On dedup hit the splits/benchmarks/report were already created on
  // the first save. Skip the Inngest dispatch — re-firing would
  // generate a second AI race report for the same race.
  if (!result.dedupHit) {
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
  }

  return NextResponse.json({
    id: result.race.id,
    personalBests: result.personalBests,
    isFinishPR: result.isFinishPR,
    priorBestFinishSeconds: result.priorBestFinishSeconds,
    raceType,
  });
}
