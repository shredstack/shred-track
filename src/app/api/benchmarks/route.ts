import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  benchmarkWorkouts,
  benchmarkWorkoutMovements,
  benchmarkWorkoutParts,
  communityMemberships,
  scores,
  workouts,
} from "@/db/schema";
import { eq, and, or, ilike, inArray } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { pickBestScore, type ScoreRow } from "@/lib/crossfit/benchmark-stats";
import type { WorkoutType } from "@/types/crossfit";
import {
  assembleBenchmarkParts,
  coerceBenchmarkMovementValues,
  coerceBenchmarkPartValues,
  fetchBenchmarkPartsAndMovements,
  type BenchmarkPartInput,
} from "@/lib/crossfit/benchmark-parts";

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

  const rows = await db
    .select()
    .from(benchmarkWorkouts)
    .where(and(...conditions))
    .orderBy(benchmarkWorkouts.name);

  const benchmarkIds = rows.map((r) => r.id);
  const { partsByBenchmark, movementsByBenchmark } =
    await fetchBenchmarkPartsAndMovements(benchmarkIds);

  // Optional: aggregate user score stats per benchmark.
  const statsByBenchmark = new Map<
    string,
    { attempts: number; bestScore: ReturnType<typeof formatBestScoreSafe>; lastAttemptDate: string | null }
  >();

  if (includeStats && benchmarkIds.length > 0) {
    const scoreRows = await db
      .select({
        scoreId: scores.id,
        workoutId: scores.workoutId,
        benchmarkWorkoutId: workouts.benchmarkWorkoutId,
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
      .where(
        and(
          eq(scores.userId, user.id),
          inArray(workouts.benchmarkWorkoutId, benchmarkIds)
        )
      );

    const grouped = new Map<string, ScoreRow[]>();
    for (const r of scoreRows) {
      const bid = r.benchmarkWorkoutId;
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

  const result = rows.map((bw) => {
    const { parts, flatMovements } = assembleBenchmarkParts(
      bw,
      partsByBenchmark.get(bw.id) ?? [],
      movementsByBenchmark.get(bw.id) ?? []
    );
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
      movements: flatMovements,
      parts,
      userStats: includeStats
        ? statsByBenchmark.get(bw.id) ?? { attempts: 0, bestScore: null, lastAttemptDate: null }
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

      if (p.movements.length > 0) {
        await tx.insert(benchmarkWorkoutMovements).values(
          p.movements.map((m, j) => ({
            benchmarkWorkoutId: bw.id,
            benchmarkWorkoutPartId: insertedPart.id,
            ...coerceBenchmarkMovementValues(m, j),
          }))
        );
      }
    }

    return bw;
  });

  return NextResponse.json(result, { status: 201 });
}
