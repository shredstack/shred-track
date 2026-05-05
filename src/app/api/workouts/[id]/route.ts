import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  workouts,
  workoutParts,
  workoutBlocks,
  workoutMovements,
  movements,
  scores,
  scoreMovementDetails,
} from "@/db/schema";
import { eq, and, inArray, notInArray } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import {
  parseRepScheme,
  type RepSchemeParsed,
} from "@/lib/crossfit/rep-scheme-parser";
import type { WorkoutType } from "@/types/crossfit";
import { normalizeSetEntries } from "@/lib/crossfit/set-entries";
import { parseDurationToSeconds } from "@/lib/crossfit/duration-parser";

// GET /api/workouts/[id] — single workout with its parts, movements, and
// (if the requester has one) the caller's scores per part.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  const { id } = await params;

  const [workout] = await db
    .select()
    .from(workouts)
    .where(eq(workouts.id, id))
    .limit(1);

  if (!workout) {
    return NextResponse.json({ error: "Workout not found" }, { status: 404 });
  }

  const parts = await db
    .select()
    .from(workoutParts)
    .where(eq(workoutParts.workoutId, id))
    .orderBy(workoutParts.orderIndex);

  const allMovements = await db
    .select({
      id: workoutMovements.id,
      workoutPartId: workoutMovements.workoutPartId,
      workoutBlockId: workoutMovements.workoutBlockId,
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
    .where(eq(workoutMovements.workoutId, id))
    .orderBy(workoutMovements.orderIndex);

  // Fetch caller's score per part (if any).
  let userScoresByPart = new Map<string, {
    id: string;
    workoutPartId: string | null;
    division: string;
    timeSeconds: number | null;
    rounds: number | null;
    remainderReps: number | null;
    weightLbs: string | null;
    totalReps: number | null;
    scoreText: string | null;
    hitTimeCap: boolean;
    notes: string | null;
    rpe: number | null;
  }>();
  let detailsByScore = new Map<string, Array<{
    workoutMovementId: string;
    wasRx: boolean;
    actualWeight: string | null;
    actualReps: string | null;
    modification: string | null;
    substitutionMovementId: string | null;
    setEntries: unknown;
    actualDurationSeconds: number | null;
    actualHeightInches: string | null;
    actualRepsPerRound: number[] | null;
    notes: string | null;
  }>>();

  if (user) {
    const userScoreRows = await db
      .select()
      .from(scores)
      .where(and(eq(scores.workoutId, id), eq(scores.userId, user.id)));

    userScoresByPart = new Map(
      userScoreRows
        .filter((s) => s.workoutPartId)
        .map((s) => [s.workoutPartId as string, s])
    );

    if (userScoreRows.length > 0) {
      const scoreIds = userScoreRows.map((s) => s.id);
      const detailRows = await db
        .select()
        .from(scoreMovementDetails)
        .where(inArray(scoreMovementDetails.scoreId, scoreIds));
      detailsByScore = new Map();
      for (const d of detailRows) {
        const list = detailsByScore.get(d.scoreId) ?? [];
        list.push({
          workoutMovementId: d.workoutMovementId,
          wasRx: d.wasRx,
          actualWeight: d.actualWeight,
          actualReps: d.actualReps,
          modification: d.modification,
          substitutionMovementId: d.substitutionMovementId,
          setEntries: d.setEntries,
          actualDurationSeconds: d.actualDurationSeconds,
          actualHeightInches: d.actualHeightInches,
          actualRepsPerRound: d.actualRepsPerRound,
          notes: d.notes,
        });
        detailsByScore.set(d.scoreId, list);
      }
    }
  }

  // Group movements by part.
  const movementsByPart = new Map<string, typeof allMovements>();
  for (const m of allMovements) {
    if (!m.workoutPartId) continue;
    const list = movementsByPart.get(m.workoutPartId) ?? [];
    list.push(m);
    movementsByPart.set(m.workoutPartId, list);
  }

  const partIds = parts.map((p) => p.id);
  const blockRows =
    partIds.length > 0
      ? await db
          .select()
          .from(workoutBlocks)
          .where(inArray(workoutBlocks.workoutPartId, partIds))
          .orderBy(workoutBlocks.orderIndex)
      : [];
  const blocksByPart = new Map<string, typeof blockRows>();
  for (const b of blockRows) {
    const list = blocksByPart.get(b.workoutPartId) ?? [];
    list.push(b);
    blocksByPart.set(b.workoutPartId, list);
  }

  const partsPayload = parts.map((p) => {
    const score = userScoresByPart.get(p.id);
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
      blocks: (blocksByPart.get(p.id) ?? []).map((b) => ({
        id: b.id,
        orderIndex: b.orderIndex,
        title: b.title,
      })),
      movements: (movementsByPart.get(p.id) ?? []).map((m) => ({
        id: m.id,
        movementId: m.movementId,
        movementName: m.movementName,
        category: m.movementCategory,
        isWeighted: m.isWeighted,
        metricType: m.metricType,
        orderIndex: m.orderIndex,
        workoutBlockId: m.workoutBlockId ?? null,
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
  });

  return NextResponse.json({
    ...workout,
    requiresVest: workout.requiresVest,
    vestWeightMaleLb:
      workout.vestWeightMaleLb != null
        ? Number(workout.vestWeightMaleLb)
        : null,
    vestWeightFemaleLb:
      workout.vestWeightFemaleLb != null
        ? Number(workout.vestWeightFemaleLb)
        : null,
    isPartner: workout.isPartner,
    partnerCount: workout.partnerCount,
    parts: partsPayload,
  });
}

interface UpdatePartMovementInput {
  id?: string;
  movementId: string;
  orderIndex?: number;
  prescribedReps?: string;
  prescribedWeightMale?: number | string;
  prescribedWeightFemale?: number | string;
  prescribedCaloriesMale?: number | string;
  prescribedCaloriesFemale?: number | string;
  prescribedDistanceMale?: number | string;
  prescribedDistanceFemale?: number | string;
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
  promoteSequenceToLadder?: boolean;
  equipmentCount?: number;
  rxStandard?: string;
  notes?: string;
  blockId?: string | null;
  blockTempRef?: string | null;
}

interface UpdatePartBlockInput {
  id?: string;
  tempRef?: string;
  title: string;
  orderIndex?: number;
}

interface UpdatePartInput {
  id?: string;
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
  movements: UpdatePartMovementInput[];
  blocks?: UpdatePartBlockInput[];
}

// PUT /api/workouts/[id] — update workout, including its parts and
// movements. Uses a diff strategy: parts/movements with an `id` are updated
// in place; new ones are inserted; ones missing from the payload are
// deleted (which cascades scores for removed parts). Existing scores on
// preserved parts survive intact.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const [existing] = await db
    .select()
    .from(workouts)
    .where(and(eq(workouts.id, id), eq(workouts.createdBy, user.id)))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Workout not found or not owned by you" }, { status: 404 });
  }

  // Vest validation: same rule as POST — if the resulting state has
  // requiresVest=true, at least one gendered vest weight must be set.
  // Compute the *final* values (incoming if provided, else existing) so a
  // partial PUT can't leave the row in an inconsistent state.
  if (body.requiresVest === true) {
    const finalMaleLb =
      body.vestWeightMaleLb !== undefined
        ? toNumericOrNull(body.vestWeightMaleLb)
        : existing.vestWeightMaleLb;
    const finalFemaleLb =
      body.vestWeightFemaleLb !== undefined
        ? toNumericOrNull(body.vestWeightFemaleLb)
        : existing.vestWeightFemaleLb;
    if (finalMaleLb == null && finalFemaleLb == null) {
      return NextResponse.json(
        { error: "Vest weight is required when requiresVest is true" },
        { status: 400 }
      );
    }
  }

  // Metadata-only update path (no parts in body) — preserves the original
  // narrow PUT behavior so existing callers keep working.
  if (!Array.isArray(body.parts)) {
    const [updated] = await db
      .update(workouts)
      .set({
        title: body.title ?? existing.title,
        description: body.description ?? existing.description,
        rawText: body.rawText ?? existing.rawText,
        workoutDate: body.workoutDate ?? existing.workoutDate,
        published: body.published ?? existing.published,
        ...(body.requiresVest !== undefined
          ? { requiresVest: !!body.requiresVest }
          : {}),
        ...(body.vestWeightMaleLb !== undefined
          ? { vestWeightMaleLb: toNumericOrNull(body.vestWeightMaleLb) }
          : {}),
        ...(body.vestWeightFemaleLb !== undefined
          ? { vestWeightFemaleLb: toNumericOrNull(body.vestWeightFemaleLb) }
          : {}),
        ...(body.isPartner !== undefined
          ? { isPartner: !!body.isPartner }
          : {}),
        ...(body.partnerCount !== undefined
          ? { partnerCount: toIntOrNull(body.partnerCount) }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(workouts.id, id))
      .returning();

    return NextResponse.json(updated);
  }

  const incomingParts = body.parts as UpdatePartInput[];
  if (incomingParts.length === 0) {
    return NextResponse.json({ error: "At least one part with movements is required" }, { status: 400 });
  }

  const firstPart = incomingParts[0];

  const result = await db.transaction(async (tx) => {
    // 1) Update workout-level fields. Mirror the first part's type/timing
    //    onto the legacy top-level columns for read-compat.
    const [updatedWorkout] = await tx
      .update(workouts)
      .set({
        title: body.title ?? existing.title,
        description: body.description ?? existing.description,
        workoutDate: body.workoutDate ?? existing.workoutDate,
        workoutType: firstPart.workoutType,
        timeCapSeconds: firstPart.timeCapSeconds || null,
        amrapDurationSeconds: firstPart.amrapDurationSeconds || null,
        repScheme: firstPart.repScheme || null,
        rounds: firstPart.rounds ?? null,
        ...(body.requiresVest !== undefined
          ? { requiresVest: !!body.requiresVest }
          : {}),
        ...(body.vestWeightMaleLb !== undefined
          ? { vestWeightMaleLb: toNumericOrNull(body.vestWeightMaleLb) }
          : {}),
        ...(body.vestWeightFemaleLb !== undefined
          ? { vestWeightFemaleLb: toNumericOrNull(body.vestWeightFemaleLb) }
          : {}),
        ...(body.isPartner !== undefined
          ? { isPartner: !!body.isPartner }
          : {}),
        ...(body.partnerCount !== undefined
          ? { partnerCount: toIntOrNull(body.partnerCount) }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(workouts.id, id))
      .returning();

    // 2) Delete parts that are no longer in the payload (cascades movements
    //    and scores for removed parts).
    const keepPartIds = incomingParts
      .map((p) => p.id)
      .filter((x): x is string => !!x);
    if (keepPartIds.length > 0) {
      await tx
        .delete(workoutParts)
        .where(
          and(
            eq(workoutParts.workoutId, id),
            notInArray(workoutParts.id, keepPartIds)
          )
        );
    } else {
      await tx.delete(workoutParts).where(eq(workoutParts.workoutId, id));
    }

    // 3) Upsert each part, then diff its movements.
    for (let i = 0; i < incomingParts.length; i++) {
      const p = incomingParts[i];
      let partId: string;

      const partValues = {
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
      };

      if (p.id) {
        const [updatedPart] = await tx
          .update(workoutParts)
          .set({ orderIndex: i, ...partValues })
          .where(
            and(eq(workoutParts.id, p.id), eq(workoutParts.workoutId, id))
          )
          .returning();
        if (!updatedPart) {
          // The id didn't belong to this workout — fall through and insert
          // as a new part rather than silently dropping the data.
          const [inserted] = await tx
            .insert(workoutParts)
            .values({ workoutId: id, orderIndex: i, ...partValues })
            .returning();
          partId = inserted.id;
        } else {
          partId = updatedPart.id;
        }
      } else {
        const [inserted] = await tx
          .insert(workoutParts)
          .values({ workoutId: id, orderIndex: i, ...partValues })
          .returning();
        partId = inserted.id;
      }

      // 3a) Diff blocks for this part. Blocks are inserted before
      // movements so movement.blockTempRef can be resolved when upserting.
      const inputBlocks = Array.isArray(p.blocks) ? p.blocks : [];
      const keepBlockIds = inputBlocks
        .map((b) => b.id)
        .filter((x): x is string => !!x);
      if (keepBlockIds.length > 0) {
        await tx
          .delete(workoutBlocks)
          .where(
            and(
              eq(workoutBlocks.workoutPartId, partId),
              notInArray(workoutBlocks.id, keepBlockIds)
            )
          );
      } else {
        await tx
          .delete(workoutBlocks)
          .where(eq(workoutBlocks.workoutPartId, partId));
      }

      const blockTempRefToId = new Map<string, string>();
      for (let k = 0; k < inputBlocks.length; k++) {
        const b = inputBlocks[k];
        const title = b.title?.toString().trim() ?? "";
        if (title.length === 0) continue;
        const blockValues = { title, orderIndex: b.orderIndex ?? k };

        if (b.id) {
          const [updatedBlock] = await tx
            .update(workoutBlocks)
            .set(blockValues)
            .where(
              and(
                eq(workoutBlocks.id, b.id),
                eq(workoutBlocks.workoutPartId, partId)
              )
            )
            .returning({ id: workoutBlocks.id });
          if (!updatedBlock) {
            const [inserted] = await tx
              .insert(workoutBlocks)
              .values({ workoutPartId: partId, ...blockValues })
              .returning({ id: workoutBlocks.id });
            if (b.tempRef) blockTempRefToId.set(b.tempRef, inserted.id);
          }
        } else {
          const [inserted] = await tx
            .insert(workoutBlocks)
            .values({ workoutPartId: partId, ...blockValues })
            .returning({ id: workoutBlocks.id });
          if (b.tempRef) blockTempRefToId.set(b.tempRef, inserted.id);
        }
      }

      // 3b) Diff movements within this part.
      const keepMovementIds = p.movements
        .map((m) => m.id)
        .filter((x): x is string => !!x);
      if (keepMovementIds.length > 0) {
        await tx
          .delete(workoutMovements)
          .where(
            and(
              eq(workoutMovements.workoutPartId, partId),
              notInArray(workoutMovements.id, keepMovementIds)
            )
          );
      } else {
        await tx
          .delete(workoutMovements)
          .where(eq(workoutMovements.workoutPartId, partId));
      }

      for (let j = 0; j < p.movements.length; j++) {
        const m = p.movements[j];
        const repSchemeParsed = parseAndPromote(
          m.prescribedReps,
          m.promoteSequenceToLadder ?? false
        );
        const workoutBlockId = m.blockTempRef
          ? blockTempRefToId.get(m.blockTempRef) ?? null
          : m.blockId ?? null;
        const fields = {
          movementId: m.movementId,
          orderIndex: m.orderIndex ?? j,
          workoutBlockId,
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
          repSchemeParsed,
          equipmentCount: m.equipmentCount ?? null,
          rxStandard: m.rxStandard || null,
          notes: m.notes || null,
        };

        if (m.id) {
          const [updated] = await tx
            .update(workoutMovements)
            .set(fields)
            .where(
              and(
                eq(workoutMovements.id, m.id),
                eq(workoutMovements.workoutPartId, partId)
              )
            )
            .returning();
          if (!updated) {
            await tx.insert(workoutMovements).values({
              workoutId: id,
              workoutPartId: partId,
              ...fields,
            });
          }
        } else {
          await tx.insert(workoutMovements).values({
            workoutId: id,
            workoutPartId: partId,
            ...fields,
          });
        }
      }
    }

    return updatedWorkout;
  });

  return NextResponse.json(result);
}

// ============================================
// Helpers (local to PUT)
// ============================================

function toIntOrNull(value: number | string | undefined | null): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function toTextOrNull(
  value: number | string | undefined | null
): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

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

function toNumericOrNull(
  value: number | string | undefined | null
): string | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return String(n);
}

function parseAndPromote(
  reps: string | null | undefined,
  promote: boolean
): RepSchemeParsed | null {
  const parsed = parseRepScheme(reps ?? null);
  if (!parsed) return null;
  if (promote && parsed.kind === "sequence" && parsed.reps.length >= 3) {
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

// DELETE /api/workouts/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const [existing] = await db
    .select()
    .from(workouts)
    .where(and(eq(workouts.id, id), eq(workouts.createdBy, user.id)))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Workout not found or not owned by you" }, { status: 404 });
  }

  await db.delete(workouts).where(eq(workouts.id, id));

  return NextResponse.json({ deleted: true });
}
