import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  crossfitWorkoutParts,
  scores,
  scoreMovementDetails,
  workoutSessions,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { normalizeSetEntries } from "@/lib/crossfit/set-entries";
import { aggregateRoundDurations } from "@/lib/crossfit/round-aggregation";
import { invalidateCrossfitInsightsCache } from "@/lib/crossfit/insights/cache";
import type { SetEntry } from "@/types/crossfit";
import { computeScoreEstimate } from "@/lib/calories/orchestrator";
import { workingWeightFromSetData } from "@/lib/calories/one-rep-max";
import { buildAppleHealthMetadata } from "@/lib/apple-health/build-metadata";

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
  actualDurationSecondsPerRound?: number[];
  actualWeightLbsPerRound?: number[];
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
    const setMax = Math.max(
      0,
      ...normalizedDetails.flatMap((d) => (d.setEntries ?? []).map((e) => e.weight))
    );
    if (setMax > 0) weightLbs = setMax;
  }
  // Athlete-weight per-round arrays are intentionally NOT derived into
  // scores.weightLbs — see scores/route.ts for the rationale.

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

  // Resolve the template id from the part — `crossfit_workout_parts.crossfit_workout_id`
  // is the canonical link, so the estimator works without trusting either
  // the legacy `scores.workoutId` (always null post-cutover) or the score's
  // session (which on multi-section days points at the synthetic group's
  // first session, not the part's session). Also pull the timed_rounds
  // config so an edit recomputes the aggregate cleanly.
  let calorieEstimate: Awaited<ReturnType<typeof computeScoreEstimate>> | null =
    null;
  let timedRoundsAggregate: number | null = null;
  let timedRoundDurations: number[] | null = null;
  if (existing.crossfitWorkoutPartId) {
    const [partRow] = await db
      .select({
        templateId: crossfitWorkoutParts.crossfitWorkoutId,
        workoutType: crossfitWorkoutParts.workoutType,
        rounds: crossfitWorkoutParts.rounds,
        roundScoreAggregation:
          crossfitWorkoutParts.roundScoreAggregation,
      })
      .from(crossfitWorkoutParts)
      .where(eq(crossfitWorkoutParts.id, existing.crossfitWorkoutPartId))
      .limit(1);
    if (partRow?.templateId) {
      try {
        calorieEstimate = await computeScoreEstimate({
          scoreId: id,
          workoutId: partRow.templateId,
          workoutPartId: existing.crossfitWorkoutPartId,
          userId: user.id,
          score: mergedScore,
          movementWeights: movementWeights.size > 0 ? movementWeights : undefined,
        });
      } catch (err) {
        console.error("[calories] estimator failed for score PUT", err);
      }
    }
    if (partRow?.workoutType === "timed_rounds") {
      // Per-round times must be strictly positive: a 0 means the round
      // didn't happen, not a real result. Mirrors the client's filter so
      // the displayed live aggregate matches what the server stores.
      const supplied = Array.isArray(body.roundDurationsSeconds)
        ? body.roundDurationsSeconds.filter(
            (n: unknown): n is number =>
              typeof n === "number" && Number.isFinite(n) && n > 0
          )
        : null;
      if (supplied && supplied.length > 0) {
        if (partRow.rounds == null) {
          return NextResponse.json(
            {
              error:
                "This part has no round count configured; contact the workout author.",
            },
            { status: 400 }
          );
        }
        const expectedRounds = partRow.rounds;
        if (supplied.length !== expectedRounds) {
          return NextResponse.json(
            {
              error: `roundDurationsSeconds.length (${supplied.length}) must equal part.rounds (${expectedRounds}); each round must be a positive number of seconds`,
            },
            { status: 400 }
          );
        }
        const rounded = supplied.map((n: number) => Math.round(n));
        timedRoundDurations = rounded;
        timedRoundsAggregate = aggregateRoundDurations(
          rounded,
          partRow.roundScoreAggregation as
            | "slowest"
            | "fastest"
            | "sum"
            | "average"
            | null
        );
      }
    }
  }

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(scores)
      .set({
        division: body.division ?? existing.division,
        // Timed Rounds: the aggregate wins over any body.timeSeconds the
        // client may have sent — they're computed from the same per-round
        // array but we want the server to be canonical.
        timeSeconds:
          timedRoundsAggregate ??
          body.timeSeconds ??
          existing.timeSeconds,
        rounds: body.rounds ?? existing.rounds,
        remainderReps: body.remainderReps ?? existing.remainderReps,
        weightLbs: weightLbs != null ? weightLbs.toString() : existing.weightLbs,
        totalReps: body.totalReps ?? existing.totalReps,
        scoreText: body.scoreText ?? existing.scoreText,
        hitTimeCap: body.hitTimeCap ?? existing.hitTimeCap,
        notes: body.notes ?? existing.notes,
        rpe: body.rpe ?? existing.rpe,
        roundDurationsSeconds:
          timedRoundDurations ?? existing.roundDurationsSeconds,
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
              actualDurationSecondsPerRound:
                Array.isArray(d.actualDurationSecondsPerRound) &&
                d.actualDurationSecondsPerRound.length > 0
                  ? d.actualDurationSecondsPerRound.map((n) =>
                      Math.max(0, Math.round(n))
                    )
                  : null,
              // Per-round athlete weight (lb). Drizzle accepts string[] for
              // numeric[]. numeric preserves half-pound entries from kg→lb.
              actualWeightLbsPerRound:
                Array.isArray(d.actualWeightLbsPerRound) &&
                d.actualWeightLbsPerRound.length > 0
                  ? d.actualWeightLbsPerRound.map((n) =>
                      String(Math.max(0, Number.isFinite(n) ? n : 0))
                    )
                  : null,
              notes: d.notes ?? null,
            }))
        );
      }
    }

    return row;
  });

  await invalidateCrossfitInsightsCache(user.id);

  // Apple Health metadata — only useful when the score hasn't been pushed
  // yet (the client guards on `appleHealthWorkoutUuid`, but no point
  // building the dict otherwise).
  let appleHealthMetadata: Awaited<
    ReturnType<typeof buildAppleHealthMetadata>
  > = null;
  if (!updated.appleHealthWorkoutUuid) {
    try {
      appleHealthMetadata = await buildAppleHealthMetadata(updated.id);
    } catch (err) {
      console.error("[apple-health] metadata build failed for score PUT", err);
    }
  }

  // Pull the session's programmed date so the client can decide whether
  // this score is recent enough to push to Apple Health's Move ring.
  let workoutDate: string | null = null;
  if (updated.workoutSessionId) {
    const [session] = await db
      .select({ workoutDate: workoutSessions.workoutDate })
      .from(workoutSessions)
      .where(eq(workoutSessions.id, updated.workoutSessionId))
      .limit(1);
    workoutDate = session?.workoutDate ?? null;
  }

  return NextResponse.json({ ...updated, workoutDate, appleHealthMetadata });
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
