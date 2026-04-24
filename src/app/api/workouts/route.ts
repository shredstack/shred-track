import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  workouts,
  workoutParts,
  workoutMovements,
  benchmarkWorkouts,
  benchmarkWorkoutMovements,
  movements,
  scores,
  scoreMovementDetails,
} from "@/db/schema";
import { eq, desc, and, inArray, gte, lte, or, ilike } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import type { WorkoutType } from "@/types/crossfit";

// ============================================
// Types
// ============================================

interface PartMovementInput {
  movementId: string;
  orderIndex?: number;
  prescribedReps?: string;
  prescribedWeightMale?: number | string;
  prescribedWeightFemale?: number | string;
  equipmentCount?: number;
  rxStandard?: string;
  notes?: string;
}

interface PartInput {
  label?: string;
  workoutType: WorkoutType;
  timeCapSeconds?: number;
  amrapDurationSeconds?: number;
  emomIntervalSeconds?: number;
  repScheme?: string;
  notes?: string;
  movements: PartMovementInput[];
}

// GET /api/workouts — list workouts.
// Supports filters:
//   ?communityId=...        — scope to a community (default: caller's own)
//   ?date=YYYY-MM-DD        — exact match on workoutDate
//   ?startDate=YYYY-MM-DD   — workoutDate >=
//   ?endDate=YYYY-MM-DD     — workoutDate <=
//   ?movementId=<uuid>      — only workouts containing this movement
//   ?q=<text>               — case-insensitive search over title/description/rawText
// Returns each workout with its nested parts, movements, and (for the
// caller's own workouts) per-part scores + movement details.
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const communityId = params.get("communityId");
  const date = params.get("date");
  const startDate = params.get("startDate");
  const endDate = params.get("endDate");
  const movementId = params.get("movementId");
  const q = params.get("q")?.trim();

  const conds = [];
  if (communityId) conds.push(eq(workouts.communityId, communityId));
  else conds.push(eq(workouts.createdBy, user.id));
  if (date) conds.push(eq(workouts.workoutDate, date));
  if (startDate) conds.push(gte(workouts.workoutDate, startDate));
  if (endDate) conds.push(lte(workouts.workoutDate, endDate));

  if (movementId) {
    const workoutIdsWithMovement = db
      .selectDistinct({ id: workoutMovements.workoutId })
      .from(workoutMovements)
      .where(eq(workoutMovements.movementId, movementId));
    conds.push(inArray(workouts.id, workoutIdsWithMovement));
  }

  if (q) {
    const pattern = `%${q}%`;
    const textCond = or(
      ilike(workouts.title, pattern),
      ilike(workouts.description, pattern),
      ilike(workouts.rawText, pattern)
    );
    if (textCond) conds.push(textCond);
  }

  // Search requests (any filter beyond date/community) return more results so
  // the user can scan history; the day-view path stays at 50 since a single
  // date rarely has more.
  const isSearch = !!(startDate || endDate || movementId || q);
  const limit = isSearch ? 100 : 50;

  const workoutRows = await db
    .select()
    .from(workouts)
    .where(and(...conds))
    .orderBy(desc(workouts.workoutDate))
    .limit(limit);

  if (workoutRows.length === 0) return NextResponse.json([]);

  const workoutIds = workoutRows.map((w) => w.id);

  // Nested fetches — all filtered by the workout IDs we already have.
  const [partRows, movementRows, scoreRows] = await Promise.all([
    db
      .select()
      .from(workoutParts)
      .where(inArray(workoutParts.workoutId, workoutIds))
      .orderBy(workoutParts.orderIndex),
    db
      .select({
        id: workoutMovements.id,
        workoutId: workoutMovements.workoutId,
        workoutPartId: workoutMovements.workoutPartId,
        movementId: workoutMovements.movementId,
        orderIndex: workoutMovements.orderIndex,
        prescribedReps: workoutMovements.prescribedReps,
        prescribedWeightMale: workoutMovements.prescribedWeightMale,
        prescribedWeightFemale: workoutMovements.prescribedWeightFemale,
        equipmentCount: workoutMovements.equipmentCount,
        rxStandard: workoutMovements.rxStandard,
        notes: workoutMovements.notes,
        movementName: movements.canonicalName,
        movementCategory: movements.category,
        isWeighted: movements.isWeighted,
      })
      .from(workoutMovements)
      .innerJoin(movements, eq(movements.id, workoutMovements.movementId))
      .where(inArray(workoutMovements.workoutId, workoutIds))
      .orderBy(workoutMovements.orderIndex),
    db
      .select()
      .from(scores)
      .where(
        and(inArray(scores.workoutId, workoutIds), eq(scores.userId, user.id))
      ),
  ]);

  const scoreIds = scoreRows.map((s) => s.id);
  const detailRows =
    scoreIds.length > 0
      ? await db
          .select()
          .from(scoreMovementDetails)
          .where(inArray(scoreMovementDetails.scoreId, scoreIds))
      : [];

  const detailsByScore = new Map<string, typeof detailRows>();
  for (const d of detailRows) {
    const list = detailsByScore.get(d.scoreId) ?? [];
    list.push(d);
    detailsByScore.set(d.scoreId, list);
  }

  const scoreByPart = new Map<string, (typeof scoreRows)[number]>();
  for (const s of scoreRows) {
    if (s.workoutPartId) scoreByPart.set(s.workoutPartId, s);
  }

  const movementsByPart = new Map<string, typeof movementRows>();
  for (const m of movementRows) {
    if (!m.workoutPartId) continue;
    const list = movementsByPart.get(m.workoutPartId) ?? [];
    list.push(m);
    movementsByPart.set(m.workoutPartId, list);
  }

  const partsByWorkout = new Map<string, typeof partRows>();
  for (const p of partRows) {
    const list = partsByWorkout.get(p.workoutId) ?? [];
    list.push(p);
    partsByWorkout.set(p.workoutId, list);
  }

  const result = workoutRows.map((w) => ({
    ...w,
    parts: (partsByWorkout.get(w.id) ?? []).map((p) => {
      const score = scoreByPart.get(p.id);
      return {
        id: p.id,
        orderIndex: p.orderIndex,
        label: p.label,
        workoutType: p.workoutType,
        timeCapSeconds: p.timeCapSeconds,
        amrapDurationSeconds: p.amrapDurationSeconds,
        emomIntervalSeconds: p.emomIntervalSeconds,
        repScheme: p.repScheme,
        notes: p.notes,
        movements: (movementsByPart.get(p.id) ?? []).map((m) => ({
          id: m.id,
          movementId: m.movementId,
          movementName: m.movementName,
          category: m.movementCategory,
          isWeighted: m.isWeighted,
          orderIndex: m.orderIndex,
          prescribedReps: m.prescribedReps,
          prescribedWeightMale: m.prescribedWeightMale,
          prescribedWeightFemale: m.prescribedWeightFemale,
          equipmentCount: m.equipmentCount,
          rxStandard: m.rxStandard,
          notes: m.notes,
        })),
        score: score
          ? {
              id: score.id,
              workoutPartId: score.workoutPartId,
              division: score.division,
              timeSeconds: score.timeSeconds ?? undefined,
              rounds: score.rounds ?? undefined,
              remainderReps: score.remainderReps ?? undefined,
              weightLbs: score.weightLbs ?? undefined,
              totalReps: score.totalReps ?? undefined,
              scoreText: score.scoreText ?? undefined,
              hitTimeCap: score.hitTimeCap,
              notes: score.notes ?? undefined,
              rpe: score.rpe ?? undefined,
              movementDetails: (detailsByScore.get(score.id) ?? []).map((d) => ({
                workoutMovementId: d.workoutMovementId,
                wasRx: d.wasRx,
                actualWeight: d.actualWeight ? Number(d.actualWeight) : undefined,
                actualReps: d.actualReps ?? undefined,
                modification: d.modification ?? undefined,
                substitutionMovementId: d.substitutionMovementId ?? undefined,
                setWeights: Array.isArray(d.setWeights)
                  ? (d.setWeights as number[])
                  : undefined,
                notes: d.notes ?? undefined,
              })),
            }
          : null,
      };
    }),
  }));

  return NextResponse.json(result);
}

// POST /api/workouts — create a workout
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const {
    title,
    description,
    rawText,
    workoutDate,
    communityId,
    published,
    source,
    benchmarkWorkoutId,
  } = body;

  // ============================================
  // Benchmark fast path — single part copied from benchmark
  // ============================================

  if (benchmarkWorkoutId) {
    const [benchmark] = await db
      .select()
      .from(benchmarkWorkouts)
      .where(eq(benchmarkWorkouts.id, benchmarkWorkoutId))
      .limit(1);

    if (!benchmark) {
      return NextResponse.json({ error: "Benchmark not found" }, { status: 404 });
    }

    const bmMovements = await db
      .select({
        movementId: benchmarkWorkoutMovements.movementId,
        orderIndex: benchmarkWorkoutMovements.orderIndex,
        prescribedReps: benchmarkWorkoutMovements.prescribedReps,
        prescribedWeightMale: benchmarkWorkoutMovements.prescribedWeightMale,
        prescribedWeightFemale: benchmarkWorkoutMovements.prescribedWeightFemale,
        rxStandard: benchmarkWorkoutMovements.rxStandard,
        notes: benchmarkWorkoutMovements.notes,
      })
      .from(benchmarkWorkoutMovements)
      .where(eq(benchmarkWorkoutMovements.benchmarkWorkoutId, benchmarkWorkoutId))
      .orderBy(benchmarkWorkoutMovements.orderIndex);

    if (!workoutDate) {
      return NextResponse.json({ error: "workoutDate is required" }, { status: 400 });
    }

    const result = await db.transaction(async (tx) => {
      const [workout] = await tx
        .insert(workouts)
        .values({
          createdBy: user.id,
          communityId: communityId || null,
          title: benchmark.name,
          description: benchmark.description,
          workoutType: benchmark.workoutType,
          timeCapSeconds: benchmark.timeCapSeconds,
          amrapDurationSeconds: benchmark.amrapDurationSeconds,
          repScheme: benchmark.repScheme,
          workoutDate,
          published: published ?? false,
          source: "benchmark",
          benchmarkWorkoutId,
        })
        .returning();

      const [part] = await tx
        .insert(workoutParts)
        .values({
          workoutId: workout.id,
          orderIndex: 0,
          workoutType: benchmark.workoutType,
          timeCapSeconds: benchmark.timeCapSeconds,
          amrapDurationSeconds: benchmark.amrapDurationSeconds,
          repScheme: benchmark.repScheme,
        })
        .returning();

      if (bmMovements.length > 0) {
        await tx.insert(workoutMovements).values(
          bmMovements.map((m) => ({
            workoutId: workout.id,
            workoutPartId: part.id,
            movementId: m.movementId,
            orderIndex: m.orderIndex,
            prescribedReps: m.prescribedReps,
            prescribedWeightMale: m.prescribedWeightMale,
            prescribedWeightFemale: m.prescribedWeightFemale,
            rxStandard: m.rxStandard,
            notes: m.notes,
          }))
        );
      }

      return workout;
    });

    return NextResponse.json(result, { status: 201 });
  }

  // ============================================
  // Parts path
  // ============================================
  //
  // Accept either the new `parts[]` shape or the legacy flat shape
  // (workoutType + movements at the top level). Legacy submissions get
  // wrapped into a single part.

  const parts: PartInput[] = normalizeParts(body);

  if (parts.length === 0) {
    return NextResponse.json({ error: "At least one part with movements is required" }, { status: 400 });
  }
  if (!workoutDate) {
    return NextResponse.json({ error: "workoutDate is required" }, { status: 400 });
  }

  const firstPart = parts[0];

  const result = await db.transaction(async (tx) => {
    const [workout] = await tx
      .insert(workouts)
      .values({
        createdBy: user.id,
        communityId: communityId || null,
        title: title || null,
        description: description || null,
        rawText: rawText || null,
        // Legacy columns mirror the first part for read-compat.
        workoutType: firstPart.workoutType,
        timeCapSeconds: firstPart.timeCapSeconds || null,
        amrapDurationSeconds: firstPart.amrapDurationSeconds || null,
        repScheme: firstPart.repScheme || null,
        workoutDate,
        published: published ?? false,
        source: source || "manual",
      })
      .returning();

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const [part] = await tx
        .insert(workoutParts)
        .values({
          workoutId: workout.id,
          orderIndex: i,
          label: p.label || null,
          workoutType: p.workoutType,
          timeCapSeconds: p.timeCapSeconds || null,
          amrapDurationSeconds: p.amrapDurationSeconds || null,
          emomIntervalSeconds: p.emomIntervalSeconds || null,
          repScheme: p.repScheme || null,
          notes: p.notes || null,
        })
        .returning();

      if (p.movements.length > 0) {
        await tx.insert(workoutMovements).values(
          p.movements.map((m, j) => ({
            workoutId: workout.id,
            workoutPartId: part.id,
            movementId: m.movementId,
            orderIndex: m.orderIndex ?? j,
            prescribedReps: m.prescribedReps || null,
            prescribedWeightMale: m.prescribedWeightMale?.toString() || null,
            prescribedWeightFemale: m.prescribedWeightFemale?.toString() || null,
            equipmentCount: m.equipmentCount ?? null,
            rxStandard: m.rxStandard || null,
            notes: m.notes || null,
          }))
        );
      }
    }

    return workout;
  });

  return NextResponse.json(result, { status: 201 });
}

// ============================================
// Accept parts[] or legacy flat shape.
// ============================================

function normalizeParts(body: Record<string, unknown>): PartInput[] {
  if (Array.isArray(body.parts)) {
    return (body.parts as PartInput[]).filter(
      (p) => p?.workoutType && Array.isArray(p.movements)
    );
  }

  // Legacy: flat { workoutType, movements, ... }
  if (body.workoutType && Array.isArray(body.movements)) {
    return [
      {
        workoutType: body.workoutType as WorkoutType,
        timeCapSeconds: body.timeCapSeconds as number | undefined,
        amrapDurationSeconds: body.amrapDurationSeconds as number | undefined,
        repScheme: body.repScheme as string | undefined,
        movements: body.movements as PartMovementInput[],
      },
    ];
  }

  return [];
}
