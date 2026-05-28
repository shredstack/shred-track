import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  benchmarkWorkouts,
  benchmarkWorkoutBlocks,
  benchmarkWorkoutMovements,
  benchmarkWorkoutParts,
  communityMemberships,
  movements,
  scores,
  workouts,
  workoutMovements,
  workoutParts,
  workoutSections,
} from "@/db/schema";
import { eq, and, or, ilike, inArray, isNull } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { pickBestScore, type ScoreRow } from "@/lib/crossfit/benchmark-stats";
import type { RepMaxTarget, RepMaxStat, WorkoutType } from "@/types/crossfit";
import {
  assembleBenchmarkParts,
  coerceBenchmarkBlockValues,
  coerceBenchmarkMovementValues,
  coerceBenchmarkPartValues,
  fetchBenchmarkPartsAndMovements,
  type BenchmarkPartInput,
} from "@/lib/crossfit/benchmark-parts";
import {
  inferRepMaxTarget,
  pickBestPerRepTarget,
} from "@/lib/crossfit/weightlifting-benchmarks";

// GET /api/benchmarks — list benchmarks visible to the user
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const search = req.nextUrl.searchParams.get("search");
  const category = req.nextUrl.searchParams.get("category");
  const benchmarkCategory = req.nextUrl.searchParams.get("benchmarkCategory");
  const communityId = req.nextUrl.searchParams.get("communityId");
  const includeStats = req.nextUrl.searchParams.get("includeStats") === "true";

  const conditions = [];

  if (category === "system") {
    conditions.push(eq(benchmarkWorkouts.isSystem, true));
  } else if (category === "custom") {
    conditions.push(
      and(
        eq(benchmarkWorkouts.createdBy, user.id),
        eq(benchmarkWorkouts.isSystem, false)
      )!
    );
  } else if (category === "community" && communityId) {
    conditions.push(eq(benchmarkWorkouts.communityId, communityId));
  } else {
    const userCommunities = await db
      .select({ communityId: communityMemberships.communityId })
      .from(communityMemberships)
      .where(eq(communityMemberships.userId, user.id));

    const communityIds = userCommunities.map((c) => c.communityId);

    const visibilityConditions = [
      eq(benchmarkWorkouts.isSystem, true),
      eq(benchmarkWorkouts.createdBy, user.id),
    ];

    if (communityIds.length > 0) {
      visibilityConditions.push(
        inArray(benchmarkWorkouts.communityId, communityIds)
      );
    }

    conditions.push(or(...visibilityConditions)!);
  }

  if (search) {
    conditions.push(ilike(benchmarkWorkouts.name, `%${search}%`));
  }

  if (benchmarkCategory) {
    conditions.push(eq(benchmarkWorkouts.category, benchmarkCategory));
  }

  // Hide weightlifting benchmarks anchored to a movement that has lost
  // `is_1rm_applicable` since seeding. The benchmark row stays in the DB
  // so existing history isn't orphaned (and direct deep-links still work),
  // but it disappears from browse.
  const oneRmMovementIds = db
    .select({ id: movements.id })
    .from(movements)
    .where(eq(movements.is1rmApplicable, true));
  conditions.push(
    or(
      isNull(benchmarkWorkouts.weightliftingMovementId),
      inArray(benchmarkWorkouts.weightliftingMovementId, oneRmMovementIds)
    )!
  );

  const rows = await db
    .select()
    .from(benchmarkWorkouts)
    .where(and(...conditions))
    .orderBy(benchmarkWorkouts.name);

  const benchmarkIds = rows.map((r) => r.id);
  const { partsByBenchmark, movementsByBenchmark, blocksByPart } =
    await fetchBenchmarkPartsAndMovements(benchmarkIds);

  // Optional: aggregate user score stats per benchmark.
  const statsByBenchmark = new Map<
    string,
    { attempts: number; bestScore: ReturnType<typeof formatBestScoreSafe>; lastAttemptDate: string | null }
  >();

  if (includeStats && benchmarkIds.length > 0) {
    // Scores can link to a benchmark via two routes:
    //   - workouts.benchmark_workout_id (personal workout = 1:1 with a benchmark)
    //   - workout_sections.benchmark_workout_id (a section inside a gym
    //     programming class day = the benchmark)
    // Select both columns; the section-level wins for bucketing when both
    // are set (would only happen if a personal workout somehow ended up
    // with sections, which doesn't occur today).
    const scoreRows = await db
      .select({
        scoreId: scores.id,
        workoutId: scores.workoutId,
        workoutBenchmarkId: workouts.benchmarkWorkoutId,
        sectionBenchmarkId: workoutSections.benchmarkWorkoutId,
        workoutType: workouts.workoutType,
        workoutDate: workouts.workoutDate,
        division: scores.division,
        timeSeconds: scores.timeSeconds,
        rounds: scores.rounds,
        remainderReps: scores.remainderReps,
        weightLbs: scores.weightLbs,
        totalReps: scores.totalReps,
        scoreText: scores.scoreText,
        hitTimeCap: scores.hitTimeCap,
        createdAt: scores.createdAt,
      })
      .from(scores)
      .innerJoin(workouts, eq(workouts.id, scores.workoutId))
      .leftJoin(workoutParts, eq(workoutParts.id, scores.workoutPartId))
      .leftJoin(
        workoutSections,
        eq(workoutSections.id, workoutParts.workoutSectionId)
      )
      .where(
        and(
          eq(scores.userId, user.id),
          or(
            inArray(workouts.benchmarkWorkoutId, benchmarkIds),
            inArray(workoutSections.benchmarkWorkoutId, benchmarkIds)
          )
        )
      );

    const grouped = new Map<string, ScoreRow[]>();
    for (const r of scoreRows) {
      const bid = r.sectionBenchmarkId ?? r.workoutBenchmarkId;
      if (!bid) continue;
      const list = grouped.get(bid) ?? [];
      list.push({
        scoreId: r.scoreId,
        workoutId: r.workoutId,
        workoutDate: r.workoutDate,
        division: r.division,
        timeSeconds: r.timeSeconds,
        rounds: r.rounds,
        remainderReps: r.remainderReps,
        weightLbs: r.weightLbs != null ? Number(r.weightLbs) : null,
        totalReps: r.totalReps,
        scoreText: r.scoreText,
        hitTimeCap: r.hitTimeCap,
        createdAt: r.createdAt.toISOString(),
      });
      grouped.set(bid, list);
    }

    for (const bw of rows) {
      const list = grouped.get(bw.id) ?? [];
      if (list.length === 0) {
        statsByBenchmark.set(bw.id, { attempts: 0, bestScore: null, lastAttemptDate: null });
        continue;
      }
      const best = pickBestScore(bw.workoutType as WorkoutType, list);
      const last = [...list].sort(
        (a, b) => +new Date(b.workoutDate) - +new Date(a.workoutDate)
      )[0];
      statsByBenchmark.set(bw.id, {
        attempts: list.length,
        bestScore: formatBestScoreSafe(bw.workoutType, best),
        lastAttemptDate: last?.workoutDate ?? null,
      });
    }
  }

  // Per-rep-max stats for weightlifting benchmarks. Pulls every for_load
  // score whose part movement matches a weightlifting anchor — even when
  // the workout wasn't auto-linked (e.g. logged before the feature
  // shipped) — so the rep-max teaser captures full history.
  const repMaxStatsByBenchmark = new Map<
    string,
    Partial<Record<RepMaxTarget, RepMaxStat>>
  >();
  const weightliftingAnchors = rows
    .filter((r) => r.weightliftingMovementId)
    .map((r) => ({ benchmarkId: r.id, movementId: r.weightliftingMovementId! }));
  if (includeStats && weightliftingAnchors.length > 0) {
    const wlMovementIds = weightliftingAnchors.map((a) => a.movementId);
    const wlRows = await db
      .select({
        scoreId: scores.id,
        weightLbs: scores.weightLbs,
        workoutDate: workouts.workoutDate,
        movementId: workoutMovements.movementId,
        partRepScheme: workoutParts.repScheme,
        // For_load workouts carry the rep scheme on the movement, not the
        // part — read both and prefer the movement value when classifying.
        movementPrescribedReps: workoutMovements.prescribedReps,
      })
      .from(scores)
      .innerJoin(workouts, eq(workouts.id, scores.workoutId))
      .innerJoin(workoutParts, eq(workoutParts.id, scores.workoutPartId))
      .innerJoin(
        workoutMovements,
        eq(workoutMovements.workoutPartId, workoutParts.id)
      )
      .where(
        and(
          eq(scores.userId, user.id),
          eq(workoutParts.workoutType, "for_load"),
          inArray(workoutMovements.movementId, wlMovementIds)
        )
      );

    const byMovement = new Map<
      string,
      Array<{
        scoreId: string;
        workoutDate: string;
        weightLbs: number;
        repTarget: RepMaxTarget;
      }>
    >();
    for (const r of wlRows) {
      const target = inferRepMaxTarget(
        r.movementPrescribedReps ?? r.partRepScheme ?? null
      );
      if (!target) continue;
      const lbs = r.weightLbs != null ? Number(r.weightLbs) : null;
      if (lbs == null) continue;
      const list = byMovement.get(r.movementId) ?? [];
      list.push({
        scoreId: r.scoreId,
        workoutDate: r.workoutDate,
        weightLbs: lbs,
        repTarget: target,
      });
      byMovement.set(r.movementId, list);
    }

    for (const anchor of weightliftingAnchors) {
      const list = byMovement.get(anchor.movementId) ?? [];
      const best = pickBestPerRepTarget(list);
      const stats: Partial<Record<RepMaxTarget, RepMaxStat>> = {};
      for (const t of [1, 2, 3, 5] as const) {
        const b = best[t];
        if (b && b.weightLbs != null) {
          stats[t] = {
            weightLbs: b.weightLbs,
            workoutDate: b.workoutDate,
            scoreId: b.scoreId,
          };
        }
      }
      repMaxStatsByBenchmark.set(anchor.benchmarkId, stats);
    }
  }

  const result = rows.map((bw) => {
    const { parts, flatMovements } = assembleBenchmarkParts(
      bw,
      partsByBenchmark.get(bw.id) ?? [],
      movementsByBenchmark.get(bw.id) ?? [],
      blocksByPart
    );
    const baseStats = includeStats
      ? statsByBenchmark.get(bw.id) ?? { attempts: 0, bestScore: null, lastAttemptDate: null }
      : undefined;
    const repMaxStats = bw.weightliftingMovementId
      ? repMaxStatsByBenchmark.get(bw.id) ?? {}
      : undefined;
    return {
      id: bw.id,
      name: bw.name,
      description: bw.description,
      workoutType: bw.workoutType,
      category: bw.category,
      timeCapSeconds: bw.timeCapSeconds,
      amrapDurationSeconds: bw.amrapDurationSeconds,
      repScheme: bw.repScheme,
      isSystem: bw.isSystem,
      createdBy: bw.createdBy,
      communityId: bw.communityId,
      requiresVest: bw.requiresVest,
      vestWeightMaleLb:
        bw.vestWeightMaleLb != null ? Number(bw.vestWeightMaleLb) : null,
      vestWeightFemaleLb:
        bw.vestWeightFemaleLb != null ? Number(bw.vestWeightFemaleLb) : null,
      isPartner: bw.isPartner,
      partnerCount: bw.partnerCount,
      weightliftingMovementId: bw.weightliftingMovementId ?? null,
      movements: flatMovements,
      parts,
      userStats: baseStats
        ? repMaxStats
          ? { ...baseStats, repMaxStats }
          : baseStats
        : undefined,
    };
  });

  return NextResponse.json(result);
}

function formatBestScoreSafe(
  workoutType: string,
  score: ScoreRow | null
): {
  display: string;
  division: string;
  workoutDate: string;
  hitTimeCap: boolean;
  timeSeconds: number | null;
  totalReps: number | null;
  weightLbs: number | null;
  rounds: number | null;
  remainderReps: number | null;
} | null {
  if (!score) return null;
  let display = score.scoreText ?? "";
  if (!display) {
    if (workoutType === "for_time" && score.timeSeconds != null) {
      const m = Math.floor(score.timeSeconds / 60);
      const s = score.timeSeconds % 60;
      display = `${m}:${s.toString().padStart(2, "0")}`;
      if (score.hitTimeCap) display = `${display} (capped)`;
    } else if (workoutType === "amrap") {
      if (score.totalReps != null) display = `${score.totalReps} reps`;
      else if (score.rounds != null) display = `${score.rounds}+${score.remainderReps ?? 0}`;
    } else if (workoutType === "for_load" || workoutType === "max_effort") {
      if (score.weightLbs != null) display = `${score.weightLbs} lb`;
    } else if (
      workoutType === "for_reps" ||
      workoutType === "for_calories" ||
      workoutType === "tabata"
    ) {
      if (score.totalReps != null) display = `${score.totalReps} reps`;
    }
    if (!display) display = "—";
  }
  return {
    display,
    division: score.division,
    workoutDate: score.workoutDate,
    hitTimeCap: score.hitTimeCap,
    timeSeconds: score.timeSeconds,
    totalReps: score.totalReps,
    weightLbs: score.weightLbs,
    rounds: score.rounds,
    remainderReps: score.remainderReps,
  };
}

// POST /api/benchmarks — create a user or community benchmark.
//
// Accepts the new multi-part shape: `{ name, description, parts: [...], ... }`.
// The first part's type/timing/repScheme is mirrored onto the legacy
// top-level columns on benchmark_workouts so older read paths keep working.
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const {
    name,
    description,
    category,
    communityId,
    isPartner,
    partnerCount,
    parts,
  } = body as {
    name?: string;
    description?: string;
    category?: string | null;
    communityId?: string | null;
    isPartner?: boolean;
    partnerCount?: number | string | null;
    parts?: BenchmarkPartInput[];
  };

  const trimmedName = name?.trim();
  if (!trimmedName || trimmedName.length > 100) {
    return NextResponse.json({ error: "Name is required (max 100 characters)" }, { status: 400 });
  }

  if (!Array.isArray(parts) || parts.length === 0) {
    return NextResponse.json(
      { error: "At least one part is required" },
      { status: 400 }
    );
  }

  for (const p of parts) {
    if (!p.workoutType) {
      return NextResponse.json(
        { error: "Each part must have a workoutType" },
        { status: 400 }
      );
    }
    if (!Array.isArray(p.movements) || p.movements.length === 0) {
      return NextResponse.json(
        { error: "Each part must have at least one movement" },
        { status: 400 }
      );
    }
  }

  const VALID_CATEGORIES = new Set([
    "girls",
    "heroes",
    "open",
    "weightlifting",
    "gym_benchmark",
  ]);
  if (category != null && category !== "" && !VALID_CATEGORIES.has(category)) {
    return NextResponse.json(
      { error: "Invalid benchmark category" },
      { status: 400 }
    );
  }

  // Name uniqueness checks (system + own).
  const systemConflict = await db
    .select({ id: benchmarkWorkouts.id })
    .from(benchmarkWorkouts)
    .where(
      and(
        eq(benchmarkWorkouts.name, trimmedName),
        eq(benchmarkWorkouts.isSystem, true)
      )
    )
    .limit(1);

  if (systemConflict.length > 0) {
    return NextResponse.json(
      { error: "A system benchmark with this name already exists" },
      { status: 409 }
    );
  }

  if (!communityId) {
    const userConflict = await db
      .select({ id: benchmarkWorkouts.id })
      .from(benchmarkWorkouts)
      .where(
        and(
          eq(benchmarkWorkouts.createdBy, user.id),
          eq(benchmarkWorkouts.name, trimmedName),
          eq(benchmarkWorkouts.isSystem, false)
        )
      )
      .limit(1);

    if (userConflict.length > 0) {
      return NextResponse.json(
        { error: "You already have a benchmark with this name" },
        { status: 409 }
      );
    }
  }

  const firstPart = parts[0];
  const firstPartValues = coerceBenchmarkPartValues(firstPart);

  const result = await db.transaction(async (tx) => {
    const [bw] = await tx
      .insert(benchmarkWorkouts)
      .values({
        name: trimmedName,
        description: description?.trim() || null,
        workoutType: firstPart.workoutType,
        category: category || null,
        timeCapSeconds: firstPartValues.timeCapSeconds,
        amrapDurationSeconds: firstPartValues.amrapDurationSeconds,
        repScheme: firstPartValues.repScheme,
        createdBy: user.id,
        communityId: communityId || null,
        isSystem: false,
        isPartner: !!isPartner,
        partnerCount:
          partnerCount != null && partnerCount !== ""
            ? Number(partnerCount)
            : null,
      })
      .returning();

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const partValues = coerceBenchmarkPartValues(p);
      const [insertedPart] = await tx
        .insert(benchmarkWorkoutParts)
        .values({
          benchmarkWorkoutId: bw.id,
          orderIndex: i,
          ...partValues,
        })
        .returning();

      const blockTempRefToId = new Map<string, string>();
      if (Array.isArray(p.blocks) && p.blocks.length > 0) {
        const blocksToInsert = p.blocks
          .map((b, k) => ({ input: b, values: coerceBenchmarkBlockValues(b, k) }))
          .filter((entry) => entry.values.title.length > 0);
        if (blocksToInsert.length > 0) {
          const inserted = await tx
            .insert(benchmarkWorkoutBlocks)
            .values(
              blocksToInsert.map((entry) => ({
                benchmarkWorkoutPartId: insertedPart.id,
                ...entry.values,
              }))
            )
            .returning({ id: benchmarkWorkoutBlocks.id });
          for (let k = 0; k < inserted.length; k++) {
            const tempRef = blocksToInsert[k].input.tempRef;
            if (tempRef) blockTempRefToId.set(tempRef, inserted[k].id);
          }
        }
      }

      if (p.movements.length > 0) {
        await tx.insert(benchmarkWorkoutMovements).values(
          p.movements.map((m, j) => {
            const resolvedBlockId = m.blockTempRef
              ? blockTempRefToId.get(m.blockTempRef) ?? null
              : m.blockId ?? null;
            return {
              benchmarkWorkoutId: bw.id,
              benchmarkWorkoutPartId: insertedPart.id,
              benchmarkWorkoutBlockId: resolvedBlockId,
              ...coerceBenchmarkMovementValues(m, j),
            };
          })
        );
      }
    }

    return bw;
  });

  return NextResponse.json(result, { status: 201 });
}
