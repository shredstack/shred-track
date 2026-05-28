import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scores, scoreMovementDetails } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { normalizeSetEntries } from "@/lib/crossfit/set-entries";
import { invalidateCrossfitInsightsCache } from "@/lib/crossfit/insights/cache";
import type { SetEntry } from "@/types/crossfit";
import { computeScoreEstimate } from "@/lib/calories/orchestrator";
import { workingWeightFromSetData } from "@/lib/calories/one-rep-max";

interface MovementDetailInput {
  workoutMovementId: string;
  wasRx?: boolean;
  actualWeight?: number;
  actualReps?: string;
  modification?: string;
  substitutionMovementId?: string;
  setEntries?: Array<SetEntry | number>;
  actualDurationSeconds?: number;
  actualHeightInches?: number;
  actualRepsPerRound?: number[];
  notes?: string;
}

// PUT /api/scores/[id] — update a score (and replace movement details)
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
    .from(scores)
    .where(and(eq(scores.id, id), eq(scores.userId, user.id)))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Score not found" }, { status: 404 });
  }

  const details: MovementDetailInput[] | undefined =
    body.movementDetails ?? body.movementScalings;

  const normalizedDetails = details?.map((d) => ({
    ...d,
    setEntries: d.setEntries ? normalizeSetEntries(d.setEntries) : undefined,
  }));

  let weightLbs = body.weightLbs;
  if (weightLbs == null && normalizedDetails) {
    const max = Math.max(
      0,
      ...normalizedDetails.flatMap((d) => (d.setEntries ?? []).map((e) => e.weight))
    );
    if (max > 0) weightLbs = max;
  }

  // Recompute the calorie estimate against the merged shape. We rebuild the
  // score context from `body` + the existing row so unrelated edits (notes,
  // movement details) don't blow away the kcal value.
  const mergedScore = {
    timeSeconds: body.timeSeconds ?? existing.timeSeconds,
    hitTimeCap: body.hitTimeCap ?? existing.hitTimeCap,
    woreVest: body.woreVest !== undefined ? body.woreVest : existing.woreVest,
    vestWeightLb:
      body.vestWeightLb != null
        ? Number(body.vestWeightLb)
        : existing.vestWeightLb != null
        ? Number(existing.vestWeightLb)
        : null,
    rpe: body.rpe ?? existing.rpe,
    startedAt: body.startedAt
      ? new Date(body.startedAt)
      : existing.startedAt
      ? new Date(existing.startedAt)
      : null,
    endedAt: body.endedAt
      ? new Date(body.endedAt)
      : existing.endedAt
      ? new Date(existing.endedAt)
      : null,
  };

  // Per-movement working weights for the load-relative modifier — only when
  // the edit actually carries movement details.
  const movementWeights = new Map<string, number>();
  for (const d of normalizedDetails ?? []) {
    if (!d.workoutMovementId) continue;
    const w = workingWeightFromSetData(d.actualWeight ?? null, d.setEntries);
    if (w != null) movementWeights.set(d.workoutMovementId, w);
  }

  // Skip the recompute when this row was written under the unified schema
  // (legacy `workoutId` is null) — the estimator's reader cuts over to
  // workoutSessionId in commit #6, and until then it can't resolve a new
  // row's prescription.
  let calorieEstimate: Awaited<ReturnType<typeof computeScoreEstimate>> | null =
    null;
  if (existing.workoutId) {
    try {
      calorieEstimate = await computeScoreEstimate({
        scoreId: id,
        workoutId: existing.workoutId,
        workoutPartId: existing.workoutPartId,
        userId: user.id,
        score: mergedScore,
        movementWeights: movementWeights.size > 0 ? movementWeights : undefined,
      });
    } catch (err) {
      console.error("[calories] estimator failed for score PUT", err);
    }
  }

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(scores)
      .set({
        division: body.division ?? existing.division,
        timeSeconds: body.timeSeconds ?? existing.timeSeconds,
        rounds: body.rounds ?? existing.rounds,
        remainderReps: body.remainderReps ?? existing.remainderReps,
        weightLbs: weightLbs != null ? weightLbs.toString() : existing.weightLbs,
        totalReps: body.totalReps ?? existing.totalReps,
        scoreText: body.scoreText ?? existing.scoreText,
        hitTimeCap: body.hitTimeCap ?? existing.hitTimeCap,
        notes: body.notes ?? existing.notes,
        rpe: body.rpe ?? existing.rpe,
        woreVest: body.woreVest !== undefined ? body.woreVest : existing.woreVest,
        vestWeightLb:
          body.vestWeightLb != null
            ? body.vestWeightLb.toString()
            : existing.vestWeightLb,
        startedAt: mergedScore.startedAt,
        endedAt: mergedScore.endedAt,
        durationSeconds: (() => {
          if (mergedScore.startedAt && mergedScore.endedAt) {
            const diff =
              (mergedScore.endedAt.getTime() - mergedScore.startedAt.getTime()) /
              1000;
            if (diff > 0) return Math.round(diff);
          }
          if (mergedScore.timeSeconds && mergedScore.timeSeconds > 0) {
            return mergedScore.timeSeconds;
          }
          return existing.durationSeconds;
        })(),
        ...(calorieEstimate
          ? {
              bodyweightLbAtScore:
                calorieEstimate.bodyweightLb != null
                  ? calorieEstimate.bodyweightLb.toString()
                  : existing.bodyweightLbAtScore,
              estimatedKcal: calorieEstimate.part.gross,
              estimatedKcalActive: calorieEstimate.part.active,
              estimatedKcalWithEpoc: calorieEstimate.part.grossWithEpoc,
              estimatedKcalActiveWithEpoc: calorieEstimate.part.activeWithEpoc,
              estimatedKcalMethod: calorieEstimate.part.method,
              estimatedKcalConfidence: calorieEstimate.part.confidence,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(scores.id, id))
      .returning();

    if (normalizedDetails) {
      await tx.delete(scoreMovementDetails).where(eq(scoreMovementDetails.scoreId, id));
      if (normalizedDetails.length > 0) {
        await tx.insert(scoreMovementDetails).values(
          normalizedDetails
            .filter((d) => d.workoutMovementId)
            .map((d) => ({
              scoreId: id,
              // Unified-schema column. Client sends crossfit_workout_movements.id
              // in the `workoutMovementId` slot post-cutover.
              crossfitWorkoutMovementId: d.workoutMovementId,
              wasRx: d.wasRx ?? true,
              actualWeight: d.actualWeight != null ? d.actualWeight.toString() : null,
              actualReps: d.actualReps ?? null,
              modification: d.modification ?? null,
              substitutionMovementId: d.substitutionMovementId ?? null,
              setEntries:
                d.setEntries && d.setEntries.length > 0 ? d.setEntries : null,
              actualDurationSeconds:
                d.actualDurationSeconds != null
                  ? Math.round(d.actualDurationSeconds)
                  : null,
              actualHeightInches:
                d.actualHeightInches != null
                  ? d.actualHeightInches.toString()
                  : null,
              actualRepsPerRound:
                Array.isArray(d.actualRepsPerRound) &&
                d.actualRepsPerRound.length > 0
                  ? d.actualRepsPerRound.map((n) => Math.max(0, Math.round(n)))
                  : null,
              notes: d.notes ?? null,
            }))
        );
      }
    }

    return row;
  });

  await invalidateCrossfitInsightsCache(user.id);

  return NextResponse.json(updated);
}

// DELETE /api/scores/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const [existing] = await db
    .select()
    .from(scores)
    .where(and(eq(scores.id, id), eq(scores.userId, user.id)))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Score not found" }, { status: 404 });
  }

  await db.delete(scores).where(eq(scores.id, id));

  await invalidateCrossfitInsightsCache(user.id);

  return NextResponse.json({ deleted: true });
}
