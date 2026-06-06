// GET /api/benchmarks — list benchmark templates visible to the caller.
// POST /api/benchmarks — create a user or community benchmark template.
//
// Unified-schema cutover: benchmarks live in `crossfit_workouts` with
// `is_benchmark = true`. Scopes:
//   • system templates       — visible globally
//   • user-created templates — `created_by = me`, `is_system = false`
//   • community templates    — `community_id = ?`
//
// Stats join (when ?includeStats=true): scores → workout_sessions →
// crossfit_workouts. The "or two FK columns" union the legacy reader did
// against `workouts.benchmark_workout_id` / `workout_sections.benchmark_
// workout_id` is gone — both collapse into `session.crossfit_workout_id`.

import { NextRequest, NextResponse } from "next/server";
import { asc, eq, and, or, ilike, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  communityMemberships,
  crossfitWorkoutMovements,
  crossfitWorkoutParts,
  crossfitWorkouts,
  movements,
  scoreMovementDetails,
  scores,
  workoutSessions,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { pickBestScore, type ScoreRow } from "@/lib/crossfit/benchmark-stats";
import type {
  RepMaxTarget,
  RepMaxStat,
  VestRequirement,
  WorkoutType,
} from "@/types/crossfit";
import {
  classifyRepMaxSets,
  pickBestPerRepTarget,
} from "@/lib/crossfit/weightlifting-benchmarks";
import { normalizeSetEntries } from "@/lib/crossfit/set-entries";
import {
  upsertTemplate,
  type TemplatePartInput,
} from "@/lib/crossfit/upsert-template";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const search = req.nextUrl.searchParams.get("search");
  const category = req.nextUrl.searchParams.get("category");
  const benchmarkCategory = req.nextUrl.searchParams.get("benchmarkCategory");
  const communityId = req.nextUrl.searchParams.get("communityId");
  const includeStats = req.nextUrl.searchParams.get("includeStats") === "true";

  const conditions = [eq(crossfitWorkouts.isBenchmark, true)];

  if (category === "system") {
    conditions.push(eq(crossfitWorkouts.isSystem, true));
  } else if (category === "custom") {
    conditions.push(
      and(
        eq(crossfitWorkouts.createdBy, user.id),
        eq(crossfitWorkouts.isSystem, false)
      )!
    );
  } else if (category === "community" && communityId) {
    conditions.push(eq(crossfitWorkouts.communityId, communityId));
  } else {
    const userCommunities = await db
      .select({ communityId: communityMemberships.communityId })
      .from(communityMemberships)
      .where(eq(communityMemberships.userId, user.id));
    const communityIds = userCommunities.map((c) => c.communityId);

    const visibilityConditions = [
      eq(crossfitWorkouts.isSystem, true),
      eq(crossfitWorkouts.createdBy, user.id),
    ];
    if (communityIds.length > 0) {
      visibilityConditions.push(
        inArray(crossfitWorkouts.communityId, communityIds)
      );
    }
    conditions.push(or(...visibilityConditions)!);
  }

  if (search) {
    conditions.push(ilike(crossfitWorkouts.title, `%${search}%`));
  }
  if (benchmarkCategory) {
    conditions.push(eq(crossfitWorkouts.category, benchmarkCategory));
  }

  // Hide weightlifting benchmarks anchored to a movement that has lost
  // `is_1rm_applicable` since seeding — the template stays in the DB so
  // history isn't orphaned, but the browse hides it.
  const oneRmMovementIds = db
    .select({ id: movements.id })
    .from(movements)
    .where(eq(movements.is1rmApplicable, true));
  conditions.push(
    or(
      isNull(crossfitWorkouts.weightliftingMovementId),
      inArray(crossfitWorkouts.weightliftingMovementId, oneRmMovementIds)
    )!
  );

  const rows = await db
    .select()
    .from(crossfitWorkouts)
    .where(and(...conditions))
    .orderBy(asc(crossfitWorkouts.title));

  const benchmarkIds = rows.map((r) => r.id);

  // Pull parts / blocks / movements in three parallel queries; assemble
  // below. Same pattern as session-reader.ts.
  const [partRows, movementRows] = await Promise.all([
    benchmarkIds.length
      ? db
          .select()
          .from(crossfitWorkoutParts)
          .where(inArray(crossfitWorkoutParts.crossfitWorkoutId, benchmarkIds))
          .orderBy(crossfitWorkoutParts.orderIndex)
      : Promise.resolve([] as never[]),
    benchmarkIds.length
      ? db
          .select({
            id: crossfitWorkoutMovements.id,
            crossfitWorkoutId: crossfitWorkoutMovements.crossfitWorkoutId,
            crossfitWorkoutPartId:
              crossfitWorkoutMovements.crossfitWorkoutPartId,
            crossfitWorkoutBlockId:
              crossfitWorkoutMovements.crossfitWorkoutBlockId,
            movementId: crossfitWorkoutMovements.movementId,
            orderIndex: crossfitWorkoutMovements.orderIndex,
            prescribedReps: crossfitWorkoutMovements.prescribedReps,
            prescribedWeightMale: crossfitWorkoutMovements.prescribedWeightMale,
            prescribedWeightFemale:
              crossfitWorkoutMovements.prescribedWeightFemale,
            prescribedCaloriesMale:
              crossfitWorkoutMovements.prescribedCaloriesMale,
            prescribedCaloriesFemale:
              crossfitWorkoutMovements.prescribedCaloriesFemale,
            prescribedDistanceMale:
              crossfitWorkoutMovements.prescribedDistanceMale,
            prescribedDistanceFemale:
              crossfitWorkoutMovements.prescribedDistanceFemale,
            prescribedDurationSecondsMale:
              crossfitWorkoutMovements.prescribedDurationSecondsMale,
            prescribedDurationSecondsFemale:
              crossfitWorkoutMovements.prescribedDurationSecondsFemale,
            prescribedHeightInches:
              crossfitWorkoutMovements.prescribedHeightInches,
            prescribedHeightInchesMale:
              crossfitWorkoutMovements.prescribedHeightInchesMale,
            prescribedHeightInchesFemale:
              crossfitWorkoutMovements.prescribedHeightInchesFemale,
            prescribedWeightMaleBwMultiplier:
              crossfitWorkoutMovements.prescribedWeightMaleBwMultiplier,
            prescribedWeightFemaleBwMultiplier:
              crossfitWorkoutMovements.prescribedWeightFemaleBwMultiplier,
            tempo: crossfitWorkoutMovements.tempo,
            isMaxReps: crossfitWorkoutMovements.isMaxReps,
            captureDurationPerRound:
              crossfitWorkoutMovements.captureDurationPerRound,
            isSideCadence: crossfitWorkoutMovements.isSideCadence,
            equipmentCount: crossfitWorkoutMovements.equipmentCount,
            rxStandard: crossfitWorkoutMovements.rxStandard,
            notes: crossfitWorkoutMovements.notes,
            movementName: movements.canonicalName,
            category: movements.category,
            isWeighted: movements.isWeighted,
            metricType: movements.metricType,
          })
          .from(crossfitWorkoutMovements)
          .innerJoin(movements, eq(movements.id, crossfitWorkoutMovements.movementId))
          .where(
            inArray(crossfitWorkoutMovements.crossfitWorkoutId, benchmarkIds)
          )
          .orderBy(crossfitWorkoutMovements.orderIndex)
      : Promise.resolve([] as never[]),
  ]);

  const partsByBenchmark = new Map<string, typeof partRows>();
  for (const p of partRows) {
    const list = partsByBenchmark.get(p.crossfitWorkoutId) ?? [];
    list.push(p);
    partsByBenchmark.set(p.crossfitWorkoutId, list);
  }
  const movementsByPart = new Map<string, typeof movementRows>();
  for (const m of movementRows) {
    const list = movementsByPart.get(m.crossfitWorkoutPartId) ?? [];
    list.push(m);
    movementsByPart.set(m.crossfitWorkoutPartId, list);
  }
  const movementsByBenchmark = new Map<string, typeof movementRows>();
  for (const m of movementRows) {
    const list = movementsByBenchmark.get(m.crossfitWorkoutId) ?? [];
    list.push(m);
    movementsByBenchmark.set(m.crossfitWorkoutId, list);
  }

  // Optional: aggregate user score stats per benchmark.
  const statsByBenchmark = new Map<
    string,
    {
      attempts: number;
      bestScore: ReturnType<typeof formatBestScoreSafe>;
      lastAttemptDate: string | null;
    }
  >();

  if (includeStats && benchmarkIds.length > 0) {
    // One-predicate join: scores → sessions where
    // session.crossfit_workout_id IN benchmarkIds. No more dual FK union.
    const scoreRows = await db
      .select({
        scoreId: scores.id,
        sessionId: scores.workoutSessionId,
        templateId: workoutSessions.crossfitWorkoutId,
        workoutType: crossfitWorkouts.workoutType,
        workoutDate: workoutSessions.workoutDate,
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
      .innerJoin(workoutSessions, eq(workoutSessions.id, scores.workoutSessionId))
      .innerJoin(crossfitWorkouts, eq(crossfitWorkouts.id, workoutSessions.crossfitWorkoutId))
      .where(
        and(
          eq(scores.userId, user.id),
          inArray(workoutSessions.crossfitWorkoutId, benchmarkIds)
        )
      );

    const grouped = new Map<string, ScoreRow[]>();
    for (const r of scoreRows) {
      if (!r.templateId) continue;
      const list = grouped.get(r.templateId) ?? [];
      list.push({
        scoreId: r.scoreId,
        sessionId: r.sessionId,
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
      grouped.set(r.templateId, list);
    }

    for (const tmpl of rows) {
      const list = grouped.get(tmpl.id) ?? [];
      if (list.length === 0) {
        statsByBenchmark.set(tmpl.id, {
          attempts: 0,
          bestScore: null,
          lastAttemptDate: null,
        });
        continue;
      }
      const best = pickBestScore(tmpl.workoutType as WorkoutType, list);
      const last = [...list].sort(
        (a, b) => +new Date(b.workoutDate) - +new Date(a.workoutDate)
      )[0];
      statsByBenchmark.set(tmpl.id, {
        attempts: list.length,
        bestScore: formatBestScoreSafe(tmpl.workoutType, best),
        lastAttemptDate: last?.workoutDate ?? null,
      });
    }
  }

  // Per-rep-max stats for weightlifting benchmarks. Joins scores →
  // sessions → template-parts → template-movements, filters to for_load
  // parts where the anchor movement is in the part.
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
        workoutDate: workoutSessions.workoutDate,
        movementId: crossfitWorkoutMovements.movementId,
        partRepScheme: crossfitWorkoutParts.repScheme,
        movementPrescribedReps: crossfitWorkoutMovements.prescribedReps,
        setEntries: scoreMovementDetails.setEntries,
        actualWeight: scoreMovementDetails.actualWeight,
      })
      .from(scores)
      .innerJoin(workoutSessions, eq(workoutSessions.id, scores.workoutSessionId))
      .innerJoin(
        crossfitWorkoutParts,
        eq(crossfitWorkoutParts.id, scores.crossfitWorkoutPartId)
      )
      .innerJoin(
        crossfitWorkoutMovements,
        eq(crossfitWorkoutMovements.crossfitWorkoutPartId, crossfitWorkoutParts.id)
      )
      .leftJoin(
        scoreMovementDetails,
        and(
          eq(scoreMovementDetails.scoreId, scores.id),
          eq(
            scoreMovementDetails.crossfitWorkoutMovementId,
            crossfitWorkoutMovements.id
          )
        )
      )
      .where(
        and(
          eq(scores.userId, user.id),
          eq(crossfitWorkoutParts.workoutType, "for_load"),
          inArray(crossfitWorkoutMovements.movementId, wlMovementIds)
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
      const buckets = classifyRepMaxSets({
        setEntries: normalizeSetEntries(r.setEntries),
        scoreWeightLbs: r.weightLbs != null ? Number(r.weightLbs) : null,
        actualWeight: r.actualWeight != null ? Number(r.actualWeight) : null,
        movementPrescribedReps: r.movementPrescribedReps,
        partRepScheme: r.partRepScheme,
      });
      if (buckets.size === 0) continue;
      const list = byMovement.get(r.movementId) ?? [];
      for (const [repTarget, weightLbs] of buckets) {
        list.push({
          scoreId: r.scoreId,
          workoutDate: r.workoutDate,
          weightLbs,
          repTarget,
        });
      }
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

  // Assemble the response — same wire shape the legacy reader produced,
  // remapping crossfit_workouts.title → name and the parts/movements
  // shape via the same per-row layout BenchmarkWorkout expects.
  const result = rows.map((bw) => {
    const parts = (partsByBenchmark.get(bw.id) ?? []).map((p) => {
      const partMovements = (movementsByPart.get(p.id) ?? []).map((m) => ({
        id: m.id,
        movementId: m.movementId,
        movementName: m.movementName,
        orderIndex: m.orderIndex,
        blockId: m.crossfitWorkoutBlockId,
        category: m.category,
        isWeighted: m.isWeighted,
        metricType: m.metricType,
        prescribedReps: m.prescribedReps,
        prescribedWeightMale:
          m.prescribedWeightMale != null
            ? Number(m.prescribedWeightMale)
            : null,
        prescribedWeightFemale:
          m.prescribedWeightFemale != null
            ? Number(m.prescribedWeightFemale)
            : null,
        prescribedCaloriesMale: m.prescribedCaloriesMale,
        prescribedCaloriesFemale: m.prescribedCaloriesFemale,
        prescribedDistanceMale: m.prescribedDistanceMale,
        prescribedDistanceFemale: m.prescribedDistanceFemale,
        prescribedDurationSecondsMale: m.prescribedDurationSecondsMale,
        prescribedDurationSecondsFemale: m.prescribedDurationSecondsFemale,
        prescribedHeightInches:
          m.prescribedHeightInches != null
            ? Number(m.prescribedHeightInches)
            : null,
        prescribedHeightInchesMale:
          m.prescribedHeightInchesMale != null
            ? Number(m.prescribedHeightInchesMale)
            : null,
        prescribedHeightInchesFemale:
          m.prescribedHeightInchesFemale != null
            ? Number(m.prescribedHeightInchesFemale)
            : null,
        prescribedWeightMaleBwMultiplier:
          m.prescribedWeightMaleBwMultiplier != null
            ? Number(m.prescribedWeightMaleBwMultiplier)
            : null,
        prescribedWeightFemaleBwMultiplier:
          m.prescribedWeightFemaleBwMultiplier != null
            ? Number(m.prescribedWeightFemaleBwMultiplier)
            : null,
        tempo: m.tempo,
        isMaxReps: !!m.isMaxReps,
        captureDurationPerRound: !!m.captureDurationPerRound,
        isSideCadence: !!m.isSideCadence,
        equipmentCount: m.equipmentCount,
        rxStandard: m.rxStandard,
        notes: m.notes,
      }));
      return {
        id: p.id,
        orderIndex: p.orderIndex,
        label: p.label,
        workoutType: p.workoutType,
        timeCapSeconds: p.timeCapSeconds,
        amrapDurationSeconds: p.amrapDurationSeconds,
        emomIntervalSeconds: p.emomIntervalSeconds,
        repScheme: p.repScheme,
        rounds: p.rounds,
        structure: p.structure,
        intervalWorkSeconds: p.intervalWorkSeconds,
        intervalRestSeconds: p.intervalRestSeconds,
        intervalRounds: p.intervalRounds,
        sideCadenceIntervalSeconds: p.sideCadenceIntervalSeconds,
        sideCadenceOpenEnded: p.sideCadenceOpenEnded,
        notes: p.notes,
        movements: partMovements,
        blocks: [],
      };
    });
    const flatMovements = (movementsByBenchmark.get(bw.id) ?? []).map((m) => ({
      id: m.id,
      movementId: m.movementId,
      movementName: m.movementName,
      orderIndex: m.orderIndex,
      blockId: m.crossfitWorkoutBlockId,
      prescribedReps: m.prescribedReps,
      prescribedWeightMale:
        m.prescribedWeightMale != null ? Number(m.prescribedWeightMale) : null,
      prescribedWeightFemale:
        m.prescribedWeightFemale != null
          ? Number(m.prescribedWeightFemale)
          : null,
    }));

    const baseStats = includeStats
      ? statsByBenchmark.get(bw.id) ?? {
          attempts: 0,
          bestScore: null,
          lastAttemptDate: null,
        }
      : undefined;
    const repMaxStats = bw.weightliftingMovementId
      ? repMaxStatsByBenchmark.get(bw.id) ?? {}
      : undefined;
    return {
      id: bw.id,
      name: bw.title,
      description: bw.description,
      workoutType: bw.workoutType,
      category: bw.category,
      timeCapSeconds: bw.timeCapSeconds,
      amrapDurationSeconds: bw.amrapDurationSeconds,
      repScheme: bw.repScheme,
      isSystem: bw.isSystem,
      createdBy: bw.createdBy,
      communityId: bw.communityId,
      vestRequirement: bw.vestRequirement as VestRequirement,
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
      else if (score.rounds != null)
        display = `${score.rounds}+${score.remainderReps ?? 0}`;
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

// POST /api/benchmarks — create a user or community benchmark template.
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
    parts?: TemplatePartInput[];
  };

  const trimmedName = name?.trim();
  if (!trimmedName || trimmedName.length > 100) {
    return NextResponse.json(
      { error: "Name is required (max 100 characters)" },
      { status: 400 }
    );
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
    .select({ id: crossfitWorkouts.id })
    .from(crossfitWorkouts)
    .where(
      and(
        eq(crossfitWorkouts.title, trimmedName),
        eq(crossfitWorkouts.isSystem, true)
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
      .select({ id: crossfitWorkouts.id })
      .from(crossfitWorkouts)
      .where(
        and(
          eq(crossfitWorkouts.createdBy, user.id),
          eq(crossfitWorkouts.title, trimmedName),
          eq(crossfitWorkouts.isSystem, false),
          eq(crossfitWorkouts.isBenchmark, true)
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
  const scope = communityId
    ? ({ kind: "community" as const, communityId })
    : ({ kind: "personal" as const, userId: user.id });

  const result = await db.transaction(async (tx) =>
    upsertTemplate(tx, {
      title: trimmedName,
      description: description?.trim() || null,
      category: category || null,
      isBenchmark: true,
      isSystem: false,
      scope,
      workoutType: firstPart.workoutType,
      timeCapSeconds: firstPart.timeCapSeconds ?? null,
      amrapDurationSeconds: firstPart.amrapDurationSeconds ?? null,
      repScheme: firstPart.repScheme ?? null,
      rounds: firstPart.rounds ?? null,
      isPartner: !!isPartner,
      partnerCount:
        partnerCount != null && partnerCount !== ""
          ? Number(partnerCount)
          : null,
      parts,
    })
  );

  return NextResponse.json(
    {
      id: result.templateId,
      name: trimmedName,
      isNew: result.isNew,
    },
    { status: 201 }
  );
}
