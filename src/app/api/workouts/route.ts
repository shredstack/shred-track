import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  workouts,
  workoutParts,
  workoutMovements,
  benchmarkWorkouts,
  benchmarkWorkoutParts,
  benchmarkWorkoutMovements,
  movements,
  scores,
  scoreMovementDetails,
} from "@/db/schema";
import { eq, desc, and, inArray, gte, lte, or, ilike } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import type { WorkoutType } from "@/types/crossfit";
import {
  parseRepScheme,
  type RepSchemeParsed,
} from "@/lib/crossfit/rep-scheme-parser";
import { normalizeSetEntries } from "@/lib/crossfit/set-entries";
import { parseDurationToSeconds } from "@/lib/crossfit/duration-parser";

// ============================================
// Types
// ============================================

interface PartMovementInput {
  movementId: string;
  orderIndex?: number;
  prescribedReps?: string;
  prescribedWeightMale?: number | string;
  prescribedWeightFemale?: number | string;
  prescribedCaloriesMale?: number | string;
  prescribedCaloriesFemale?: number | string;
  prescribedDistanceMale?: number | string;
  prescribedDistanceFemale?: number | string;
  // Hint flag from the builder. When true and the parsed shape comes back
  // as a closed arithmetic sequence, the server promotes it to an open
  // ladder before persisting. See rep-scheme-parser for the rules.
  promoteSequenceToLadder?: boolean;
  equipmentCount?: number;
  rxStandard?: string;
  notes?: string;
  // PushPress Parity: free text from the builder (parsed here) or a
  // pre-parsed seconds value from API integrations.
  prescribedDurationSecondsMale?: number | string;
  prescribedDurationSecondsFemale?: number | string;
  prescribedHeightInches?: number | string;
  prescribedHeightInchesMale?: number | string;
  prescribedHeightInchesFemale?: number | string;
  prescribedWeightMaleBwMultiplier?: number | string;
  prescribedWeightFemaleBwMultiplier?: number | string;
  tempo?: string;
  isMaxReps?: boolean;
  isSideCadence?: boolean;
}

interface PartInput {
  label?: string;
  workoutType: WorkoutType;
  timeCapSeconds?: number;
  amrapDurationSeconds?: number;
  emomIntervalSeconds?: number;
  intervalWorkSeconds?: number | string;
  intervalRestSeconds?: number | string;
  intervalRounds?: { workSeconds: number | string; restSeconds: number | string }[];
  sideCadenceIntervalSeconds?: number | string;
  sideCadenceOpenEnded?: boolean;
  repScheme?: string;
  rounds?: number;
  structure?: string;
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
        prescribedCaloriesMale: workoutMovements.prescribedCaloriesMale,
        prescribedCaloriesFemale: workoutMovements.prescribedCaloriesFemale,
        prescribedDistanceMale: workoutMovements.prescribedDistanceMale,
        prescribedDistanceFemale: workoutMovements.prescribedDistanceFemale,
        prescribedDurationSecondsMale:
          workoutMovements.prescribedDurationSecondsMale,
        prescribedDurationSecondsFemale:
          workoutMovements.prescribedDurationSecondsFemale,
        prescribedHeightInches: workoutMovements.prescribedHeightInches,
        prescribedHeightInchesMale:
          workoutMovements.prescribedHeightInchesMale,
        prescribedHeightInchesFemale:
          workoutMovements.prescribedHeightInchesFemale,
        prescribedWeightMaleBwMultiplier:
          workoutMovements.prescribedWeightMaleBwMultiplier,
        prescribedWeightFemaleBwMultiplier:
          workoutMovements.prescribedWeightFemaleBwMultiplier,
        tempo: workoutMovements.tempo,
        isMaxReps: workoutMovements.isMaxReps,
        isSideCadence: workoutMovements.isSideCadence,
        repSchemeParsed: workoutMovements.repSchemeParsed,
        equipmentCount: workoutMovements.equipmentCount,
        rxStandard: workoutMovements.rxStandard,
        notes: workoutMovements.notes,
        movementName: movements.canonicalName,
        movementCategory: movements.category,
        isWeighted: movements.isWeighted,
        metricType: movements.metricType,
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
    requiresVest: w.requiresVest,
    vestWeightMaleLb:
      w.vestWeightMaleLb != null ? Number(w.vestWeightMaleLb) : null,
    vestWeightFemaleLb:
      w.vestWeightFemaleLb != null ? Number(w.vestWeightFemaleLb) : null,
    isPartner: w.isPartner,
    partnerCount: w.partnerCount,
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
        intervalWorkSeconds: p.intervalWorkSeconds,
        intervalRestSeconds: p.intervalRestSeconds,
        intervalRounds: p.intervalRounds,
        sideCadenceIntervalSeconds: p.sideCadenceIntervalSeconds,
        sideCadenceOpenEnded: p.sideCadenceOpenEnded,
        repScheme: p.repScheme,
        rounds: p.rounds,
        structure: p.structure,
        notes: p.notes,
        movements: (movementsByPart.get(p.id) ?? []).map((m) => ({
          id: m.id,
          movementId: m.movementId,
          movementName: m.movementName,
          category: m.movementCategory,
          isWeighted: m.isWeighted,
          metricType: m.metricType,
          orderIndex: m.orderIndex,
          prescribedReps: m.prescribedReps,
          prescribedWeightMale: m.prescribedWeightMale,
          prescribedWeightFemale: m.prescribedWeightFemale,
          prescribedCaloriesMale: m.prescribedCaloriesMale,
          prescribedCaloriesFemale: m.prescribedCaloriesFemale,
          prescribedDistanceMale: m.prescribedDistanceMale,
          prescribedDistanceFemale: m.prescribedDistanceFemale,
          prescribedDurationSecondsMale:
            m.prescribedDurationSecondsMale ?? undefined,
          prescribedDurationSecondsFemale:
            m.prescribedDurationSecondsFemale ?? undefined,
          prescribedHeightInches:
            m.prescribedHeightInches != null
              ? Number(m.prescribedHeightInches)
              : undefined,
          prescribedHeightInchesMale:
            m.prescribedHeightInchesMale != null
              ? Number(m.prescribedHeightInchesMale)
              : undefined,
          prescribedHeightInchesFemale:
            m.prescribedHeightInchesFemale != null
              ? Number(m.prescribedHeightInchesFemale)
              : undefined,
          prescribedWeightMaleBwMultiplier:
            m.prescribedWeightMaleBwMultiplier != null
              ? Number(m.prescribedWeightMaleBwMultiplier)
              : undefined,
          prescribedWeightFemaleBwMultiplier:
            m.prescribedWeightFemaleBwMultiplier != null
              ? Number(m.prescribedWeightFemaleBwMultiplier)
              : undefined,
          tempo: m.tempo ?? undefined,
          isMaxReps: !!m.isMaxReps,
          isSideCadence: !!m.isSideCadence,
          repSchemeParsed: m.repSchemeParsed,
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
              woreVest: score.woreVest ?? undefined,
              vestWeightLb:
                score.vestWeightLb != null
                  ? Number(score.vestWeightLb)
                  : undefined,
              movementDetails: (detailsByScore.get(score.id) ?? []).map((d) => {
                const entries = normalizeSetEntries(d.setEntries);
                return {
                  workoutMovementId: d.workoutMovementId,
                  wasRx: d.wasRx,
                  actualWeight: d.actualWeight ? Number(d.actualWeight) : undefined,
                  actualReps: d.actualReps ?? undefined,
                  modification: d.modification ?? undefined,
                  substitutionMovementId: d.substitutionMovementId ?? undefined,
                  setEntries: entries.length > 0 ? entries : undefined,
                  actualDurationSeconds: d.actualDurationSeconds ?? undefined,
                  actualHeightInches:
                    d.actualHeightInches != null
                      ? Number(d.actualHeightInches)
                      : undefined,
                  actualRepsPerRound:
                    d.actualRepsPerRound && d.actualRepsPerRound.length > 0
                      ? d.actualRepsPerRound
                      : undefined,
                  notes: d.notes ?? undefined,
                };
              }),
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
    requiresVest,
    vestWeightMaleLb,
    vestWeightFemaleLb,
    isPartner,
    partnerCount,
  } = body;

  // Vest validation: if the workout claims it requires a vest, at least
  // one of the gendered weights must be set. We won't trust a "true"
  // toggle with no weight on either side.
  if (requiresVest === true) {
    if (
      vestWeightMaleLb == null &&
      vestWeightFemaleLb == null
    ) {
      return NextResponse.json(
        { error: "Vest weight is required when requiresVest is true" },
        { status: 400 }
      );
    }
  }

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

    // Multi-part benchmark support — when the benchmark has explicit
    // parts (newer / Drew-style), copy each part to the new workout. The
    // legacy single-part path is preserved as a fallback for benchmarks
    // that haven't been migrated to parts.
    const bmParts = await db
      .select()
      .from(benchmarkWorkoutParts)
      .where(eq(benchmarkWorkoutParts.benchmarkWorkoutId, benchmarkWorkoutId))
      .orderBy(benchmarkWorkoutParts.orderIndex);

    const bmMovements = await db
      .select({
        movementId: benchmarkWorkoutMovements.movementId,
        orderIndex: benchmarkWorkoutMovements.orderIndex,
        benchmarkWorkoutPartId: benchmarkWorkoutMovements.benchmarkWorkoutPartId,
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
          // Inherit vest prescription from the benchmark.
          requiresVest: !!benchmark.requiresVest,
          vestWeightMaleLb: benchmark.vestWeightMaleLb ?? null,
          vestWeightFemaleLb: benchmark.vestWeightFemaleLb ?? null,
          // Inherit partner flag from the benchmark.
          isPartner: !!benchmark.isPartner,
          partnerCount: benchmark.partnerCount ?? null,
        })
        .returning();

      // Either copy each benchmark part 1:1, or fall back to a single
      // synthetic part on legacy single-part benchmarks.
      const partsToInsert =
        bmParts.length > 0
          ? bmParts.map((bp) => ({
              workoutId: workout.id,
              orderIndex: bp.orderIndex,
              label: bp.label,
              workoutType: bp.workoutType,
              timeCapSeconds: bp.timeCapSeconds,
              amrapDurationSeconds: bp.amrapDurationSeconds,
              emomIntervalSeconds: bp.emomIntervalSeconds,
              repScheme: bp.repScheme,
              rounds: bp.rounds,
              structure: bp.structure,
              intervalWorkSeconds: bp.intervalWorkSeconds,
              intervalRestSeconds: bp.intervalRestSeconds,
              intervalRounds: bp.intervalRounds,
              sideCadenceIntervalSeconds: bp.sideCadenceIntervalSeconds,
              sideCadenceOpenEnded: bp.sideCadenceOpenEnded,
              notes: bp.notes,
              // Carry the source part id so we can wire movements back to
              // the right part below.
              sourceBenchmarkPartId: bp.id,
            }))
          : [
              {
                workoutId: workout.id,
                orderIndex: 0,
                label: null,
                workoutType: benchmark.workoutType,
                timeCapSeconds: benchmark.timeCapSeconds,
                amrapDurationSeconds: benchmark.amrapDurationSeconds,
                emomIntervalSeconds: null,
                repScheme: benchmark.repScheme,
                rounds: null,
                structure: null,
                intervalWorkSeconds: null,
                intervalRestSeconds: null,
                intervalRounds: null,
                sideCadenceIntervalSeconds: null,
                sideCadenceOpenEnded: false,
                notes: null,
                sourceBenchmarkPartId: null as string | null,
              },
            ];

      const benchmarkPartIdToWorkoutPartId = new Map<string, string>();
      let firstWorkoutPartId: string | null = null;
      for (const p of partsToInsert) {
        const { sourceBenchmarkPartId, ...insertValues } = p;
        const [insertedPart] = await tx
          .insert(workoutParts)
          .values(insertValues)
          .returning();
        if (firstWorkoutPartId == null) firstWorkoutPartId = insertedPart.id;
        if (sourceBenchmarkPartId) {
          benchmarkPartIdToWorkoutPartId.set(
            sourceBenchmarkPartId,
            insertedPart.id
          );
        }
      }

      if (bmMovements.length > 0) {
        await tx.insert(workoutMovements).values(
          bmMovements.map((m) => {
            const partId = m.benchmarkWorkoutPartId
              ? benchmarkPartIdToWorkoutPartId.get(m.benchmarkWorkoutPartId) ??
                firstWorkoutPartId!
              : firstWorkoutPartId!;
            return {
              workoutId: workout.id,
              workoutPartId: partId,
              movementId: m.movementId,
              orderIndex: m.orderIndex,
              prescribedReps: m.prescribedReps,
              prescribedWeightMale: m.prescribedWeightMale,
              prescribedWeightFemale: m.prescribedWeightFemale,
              // Parse benchmark rep schemes too — benchmarks like "Cindy"
              // (5-10-15 ladder territory) get the same structured shape as
              // user-built workouts.
              repSchemeParsed: parseAndPromote(m.prescribedReps, false),
              rxStandard: m.rxStandard,
              notes: m.notes,
            };
          })
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
        rounds: firstPart.rounds ?? null,
        workoutDate,
        published: published ?? false,
        source: source || "manual",
        requiresVest: !!requiresVest,
        vestWeightMaleLb: toNumericOrNull(vestWeightMaleLb),
        vestWeightFemaleLb: toNumericOrNull(vestWeightFemaleLb),
        isPartner: !!isPartner,
        partnerCount: toIntOrNull(partnerCount),
      })
      .returning();

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];

      if (p.workoutType === "intervals") {
        const normalizedRounds = normalizeIntervalRounds(p.intervalRounds);
        if (!normalizedRounds) {
          const work = toDurationSecondsOrNull(p.intervalWorkSeconds);
          const rest = toDurationSecondsOrNull(p.intervalRestSeconds);
          if (!p.rounds || work == null || rest == null) {
            throw new Error(
              "Intervals parts require rounds plus either intervalWorkSeconds/Rest or a per-round intervalRounds array"
            );
          }
        }
      }

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
          intervalWorkSeconds: toDurationSecondsOrNull(p.intervalWorkSeconds),
          intervalRestSeconds: toDurationSecondsOrNull(p.intervalRestSeconds),
          intervalRounds: normalizeIntervalRounds(p.intervalRounds),
          sideCadenceIntervalSeconds: toDurationSecondsOrNull(
            p.sideCadenceIntervalSeconds
          ),
          sideCadenceOpenEnded: !!p.sideCadenceOpenEnded,
          repScheme: p.repScheme || null,
          rounds: p.rounds ?? null,
          structure: p.structure || null,
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
            prescribedCaloriesMale: toTextOrNull(m.prescribedCaloriesMale),
            prescribedCaloriesFemale: toTextOrNull(m.prescribedCaloriesFemale),
            prescribedDistanceMale: toTextOrNull(m.prescribedDistanceMale),
            prescribedDistanceFemale: toTextOrNull(m.prescribedDistanceFemale),
            prescribedDurationSecondsMale: toDurationSecondsOrNull(
              m.prescribedDurationSecondsMale
            ),
            prescribedDurationSecondsFemale: toDurationSecondsOrNull(
              m.prescribedDurationSecondsFemale
            ),
            prescribedHeightInches: toNumericOrNull(m.prescribedHeightInches),
            prescribedHeightInchesMale: toNumericOrNull(
              m.prescribedHeightInchesMale
            ),
            prescribedHeightInchesFemale: toNumericOrNull(
              m.prescribedHeightInchesFemale
            ),
            prescribedWeightMaleBwMultiplier: toNumericOrNull(
              m.prescribedWeightMaleBwMultiplier
            ),
            prescribedWeightFemaleBwMultiplier: toNumericOrNull(
              m.prescribedWeightFemaleBwMultiplier
            ),
            tempo: m.tempo?.trim() || null,
            isMaxReps: !!m.isMaxReps,
            isSideCadence: !!m.isSideCadence,
            // Server is the single source of truth for the parsed shape —
            // we ignore any client-provided value to avoid drift if the
            // parser changes.
            repSchemeParsed: parseAndPromote(
              m.prescribedReps,
              m.promoteSequenceToLadder ?? false
            ),
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
// Helpers
// ============================================

function toIntOrNull(value: number | string | undefined | null): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

// Text/scheme columns (calories, distance) accept either a scalar or a
// rep-scheme string ("21", "75-50-25"). We trim and reject empty.
function toTextOrNull(
  value: number | string | undefined | null
): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

// Accepts seconds-as-number or a free-text duration ("1:30", ":30", "90s",
// "1m30s"). Returns null when unparseable. Used for the new
// prescribedDuration* fields and intervalWork/Rest seconds.
function toDurationSecondsOrNull(
  value: number | string | undefined | null
): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  }
  return parseDurationToSeconds(value);
}

function normalizeIntervalRounds(
  rounds:
    | { workSeconds: number | string; restSeconds: number | string }[]
    | null
    | undefined
): { workSeconds: number; restSeconds: number }[] | null {
  if (!Array.isArray(rounds) || rounds.length === 0) return null;
  const out: { workSeconds: number; restSeconds: number }[] = [];
  for (const r of rounds) {
    const w = toDurationSecondsOrNull(r.workSeconds);
    const rest = toDurationSecondsOrNull(r.restSeconds);
    if (w == null || rest == null) return null;
    out.push({ workSeconds: w, restSeconds: rest });
  }
  return out;
}

// String → numeric (for height inches, BW multipliers).
function toNumericOrNull(
  value: number | string | undefined | null
): string | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return String(n);
}

// Parse + apply the "Continue as ladder?" promotion the builder may have
// requested. Returns null when the input doesn't parse — the score logger
// degrades cleanly to today's behavior in that case.
function parseAndPromote(
  reps: string | null | undefined,
  promote: boolean
): RepSchemeParsed | null {
  const parsed = parseRepScheme(reps ?? null);
  if (!parsed) return null;
  if (
    promote &&
    parsed.kind === "sequence" &&
    parsed.reps.length >= 3
  ) {
    const step = parsed.reps[1] - parsed.reps[0];
    if (step <= 0) return parsed;
    let ok = true;
    for (let i = 2; i < parsed.reps.length; i++) {
      if (parsed.reps[i] - parsed.reps[i - 1] !== step) {
        ok = false;
        break;
      }
    }
    if (ok) {
      return { kind: "ladder", start: parsed.reps[0], step, openEnded: true };
    }
  }
  return parsed;
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
        rounds: body.rounds as number | undefined,
        movements: body.movements as PartMovementInput[],
      },
    ];
  }

  return [];
}
