import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  communityMemberships,
  crossfitWorkoutParts,
  familyMembers,
  scores,
  scoreMovementDetails,
  workouts,
  workoutSessions,
} from "@/db/schema";
import { and, eq, desc, asc } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { normalizeSetEntries } from "@/lib/crossfit/set-entries";
import { invalidateCrossfitInsightsCache } from "@/lib/crossfit/insights/cache";
import type { SetEntry } from "@/types/crossfit";
import { computeScoreEstimate } from "@/lib/calories/orchestrator";
import { workingWeightFromSetData } from "@/lib/calories/one-rep-max";

// ============================================
// Request types
// ============================================

interface MovementDetailInput {
  workoutMovementId: string;
  wasRx?: boolean;
  actualWeight?: number;
  actualReps?: string;
  modification?: string;
  substitutionMovementId?: string;
  // Accept either the canonical shape or the legacy number[] for backward
  // compatibility — old clients that haven't shipped yet may still send it.
  setEntries?: Array<SetEntry | number>;
  actualDurationSeconds?: number;
  actualHeightInches?: number;
  actualRepsPerRound?: number[];
  notes?: string;
}

interface ScorePostBody {
  // In the unified schema `workoutId` is the workout_sessions.id (the
  // session.id that GET returns post-cutover). The field name is preserved
  // for client backwards-compat; it stops being a `workouts.id` once the
  // legacy table is dropped. `workoutPartId` is a crossfit_workout_parts.id.
  workoutId?: string;
  workoutPartId?: string;
  // Dependents (family_memberships): account holder logging on behalf
  // of a dependent. When set, the row's user_id is the dependent's id
  // (must be a family_members.dependent_user_id of the caller in the
  // session's gym). When null, the row's user_id is the caller.
  forUserId?: string;
  division: "rx" | "scaled" | "rx_plus";
  timeSeconds?: number;
  rounds?: number;
  remainderReps?: number;
  weightLbs?: number;
  totalReps?: number;
  scoreText?: string;
  hitTimeCap?: boolean;
  notes?: string;
  rpe?: number;
  woreVest?: boolean;
  vestWeightLb?: number;
  // Live-logger bracket. When omitted, the calorie estimator falls back to
  // the score's own time fields and (last resort) the part's time cap.
  startedAt?: string;
  endedAt?: string;
  movementDetails?: MovementDetailInput[];
  // Legacy name used by client before multi-part landed.
  movementScalings?: MovementDetailInput[];
}

// GET /api/scores — list user's scores
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workoutId = req.nextUrl.searchParams.get("workoutId");

  const rows = workoutId
    ? await db
        .select()
        .from(scores)
        .where(eq(scores.workoutId, workoutId))
        .orderBy(desc(scores.createdAt))
    : await db
        .select({
          id: scores.id,
          workoutId: scores.workoutId,
          workoutPartId: scores.workoutPartId,
          division: scores.division,
          timeSeconds: scores.timeSeconds,
          rounds: scores.rounds,
          remainderReps: scores.remainderReps,
          weightLbs: scores.weightLbs,
          totalReps: scores.totalReps,
          scoreText: scores.scoreText,
          hitTimeCap: scores.hitTimeCap,
          notes: scores.notes,
          rpe: scores.rpe,
          createdAt: scores.createdAt,
          workoutTitle: workouts.title,
          workoutType: workouts.workoutType,
          workoutDate: workouts.workoutDate,
        })
        .from(scores)
        .innerJoin(workouts, eq(workouts.id, scores.workoutId))
        .where(eq(scores.userId, user.id))
        .orderBy(desc(scores.createdAt))
        .limit(50);

  return NextResponse.json(rows);
}

// POST /api/scores — log a score against a workout session + template part.
//
// Unified-schema cutover: `workoutId` in the body resolves to a
// `workout_sessions.id`; `workoutPartId` resolves to a
// `crossfit_workout_parts.id`. Legacy clients that only send `workoutId`
// auto-resolve to the session's template's first part. The score row
// itself is written with `workoutSessionId` + `crossfitWorkoutPartId`
// populated and the legacy `workoutId` / `workoutPartId` columns left
// null (a separate migration drops the NOT NULL on the legacy column).
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as ScorePostBody;
  const { workoutId: rawSessionId, workoutPartId: rawPartId, division } = body;

  if (!division) {
    return NextResponse.json({ error: "division is required" }, { status: 400 });
  }

  // Resolve sessionId + part-id (now a crossfit_workout_parts.id). A
  // legacy client that sends only sessionId gets auto-resolved to the
  // session's template's first part.
  let workoutSessionId = rawSessionId;
  let crossfitWorkoutPartId = rawPartId;

  if (!crossfitWorkoutPartId) {
    if (!workoutSessionId) {
      return NextResponse.json(
        { error: "workoutPartId or workoutId is required" },
        { status: 400 }
      );
    }
    const [session] = await db
      .select({ crossfitWorkoutId: workoutSessions.crossfitWorkoutId })
      .from(workoutSessions)
      .where(eq(workoutSessions.id, workoutSessionId))
      .limit(1);
    if (!session?.crossfitWorkoutId) {
      return NextResponse.json(
        { error: "Session has no template (warm-up / stretching cannot be scored)" },
        { status: 400 }
      );
    }
    const [firstPart] = await db
      .select({ id: crossfitWorkoutParts.id })
      .from(crossfitWorkoutParts)
      .where(eq(crossfitWorkoutParts.crossfitWorkoutId, session.crossfitWorkoutId))
      .orderBy(asc(crossfitWorkoutParts.orderIndex))
      .limit(1);
    if (!firstPart) {
      return NextResponse.json(
        { error: "Template has no parts" },
        { status: 400 }
      );
    }
    crossfitWorkoutPartId = firstPart.id;
  } else if (!workoutSessionId) {
    // A part id was supplied but no session id. The part belongs to a
    // template; we need the SESSION the athlete logged this score against,
    // not just the template. Without a session context (e.g. a benchmark
    // score with no day attached) we can't write a valid row — that's an
    // unsupported flow in the unified schema (every score is tied to a
    // dated session). Return a clear error.
    return NextResponse.json(
      { error: "workoutId (session id) is required" },
      { status: 400 }
    );
  }

  // Resolve effective user_id. "Log for" override (spec §8) lets an
  // account holder log scores on behalf of a dependent in the same gym.
  let effectiveUserId = user.id;
  if (body.forUserId && body.forUserId !== user.id) {
    const [s] = await db
      .select({ communityId: workoutSessions.communityId })
      .from(workoutSessions)
      .where(eq(workoutSessions.id, workoutSessionId!))
      .limit(1);
    if (!s?.communityId) {
      return NextResponse.json(
        { error: "Can only log for a dependent in a gym workout" },
        { status: 400 }
      );
    }
    const [link] = await db
      .select({ id: familyMembers.id })
      .from(familyMembers)
      .where(
        and(
          eq(familyMembers.accountHolderUserId, user.id),
          eq(familyMembers.dependentUserId, body.forUserId),
          eq(familyMembers.communityId, s.communityId)
        )
      )
      .limit(1);
    if (!link) {
      return NextResponse.json(
        { error: "You don't manage that dependent in this gym" },
        { status: 403 }
      );
    }
    // Defense in depth: the family link is only meaningful while the
    // account holder is still an active member of the gym. A removed /
    // deactivated holder shouldn't be able to keep logging for dependents.
    const [callerMembership] = await db
      .select({ id: communityMemberships.id })
      .from(communityMemberships)
      .where(
        and(
          eq(communityMemberships.communityId, s.communityId),
          eq(communityMemberships.userId, user.id),
          eq(communityMemberships.isActive, true)
        )
      )
      .limit(1);
    if (!callerMembership) {
      return NextResponse.json(
        { error: "You're no longer an active member of this gym" },
        { status: 403 }
      );
    }
    effectiveUserId = body.forUserId;
  }

  const details = body.movementDetails ?? body.movementScalings ?? [];

  // Normalize setEntries on every detail up front so downstream code can
  // assume the canonical shape.
  const normalizedDetails = details.map((d) => ({
    ...d,
    setEntries: d.setEntries ? normalizeSetEntries(d.setEntries) : undefined,
  }));

  // Derive weightLbs from per-set entries for for_load parts when not
  // explicitly provided. The canonical per-set data lives in
  // scoreMovementDetails; scores.weightLbs is a summary for legacy queries.
  let weightLbs = body.weightLbs;
  if (weightLbs == null) {
    const max = Math.max(
      0,
      ...normalizedDetails.flatMap((d) => (d.setEntries ?? []).map((e) => e.weight))
    );
    if (max > 0) weightLbs = max;
  }

  const startedAt = body.startedAt ? new Date(body.startedAt) : null;
  const endedAt = body.endedAt ? new Date(body.endedAt) : null;

  // Per-movement working weights (lb) for the load-relative calorie modifier.
  // Keyed by workout_movements.id — the score row doesn't exist yet, so this
  // comes straight off the request body.
  const movementWeights = new Map<string, number>();
  for (const d of normalizedDetails) {
    if (!d.workoutMovementId) continue;
    const w = workingWeightFromSetData(d.actualWeight ?? null, d.setEntries);
    if (w != null) movementWeights.set(d.workoutMovementId, w);
  }

  // Compute the personalized calorie estimate before opening the
  // transaction. computeScoreEstimate still reads from the legacy tables
  // in commit #5; it'll be cut over to the unified schema in commit #6.
  // Until then, new sessions/templates won't resolve and the estimator
  // returns null — caught and ignored below.
  let calorieEstimate: Awaited<ReturnType<typeof computeScoreEstimate>> | null =
    null;
  try {
    calorieEstimate = await computeScoreEstimate({
      workoutId: workoutSessionId!,
      workoutPartId: crossfitWorkoutPartId,
      userId: effectiveUserId,
      movementWeights,
      score: {
        timeSeconds: body.timeSeconds ?? null,
        hitTimeCap: body.hitTimeCap ?? false,
        woreVest: body.woreVest ?? null,
        vestWeightLb: body.vestWeightLb ?? null,
        rpe: body.rpe ?? null,
        startedAt,
        endedAt,
      },
    });
  } catch (err) {
    // Never block score save on estimator failure. Log and continue.
    console.error("[calories] estimator failed for score POST", err);
  }

  const durationSeconds = (() => {
    if (startedAt && endedAt) {
      const diff = (endedAt.getTime() - startedAt.getTime()) / 1000;
      if (diff > 0) return Math.round(diff);
    }
    if (body.timeSeconds && body.timeSeconds > 0) return body.timeSeconds;
    return null;
  })();

  try {
    const score = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(scores)
        .values({
          // Legacy columns left null on the unified-schema write path —
          // see migration 20260528180000 which dropped the NOT NULL.
          workoutSessionId: workoutSessionId!,
          crossfitWorkoutPartId,
          userId: effectiveUserId,
          division,
          timeSeconds: body.timeSeconds ?? null,
          rounds: body.rounds ?? null,
          remainderReps: body.remainderReps ?? null,
          weightLbs: weightLbs != null ? weightLbs.toString() : null,
          totalReps: body.totalReps ?? null,
          scoreText: body.scoreText ?? null,
          hitTimeCap: body.hitTimeCap ?? false,
          notes: body.notes ?? null,
          rpe: body.rpe ?? null,
          woreVest: body.woreVest ?? null,
          vestWeightLb:
            body.vestWeightLb != null ? body.vestWeightLb.toString() : null,
          startedAt,
          endedAt,
          durationSeconds,
          bodyweightLbAtScore:
            calorieEstimate?.bodyweightLb != null
              ? calorieEstimate.bodyweightLb.toString()
              : null,
          estimatedKcal: calorieEstimate?.part.gross ?? null,
          estimatedKcalActive: calorieEstimate?.part.active ?? null,
          estimatedKcalWithEpoc: calorieEstimate?.part.grossWithEpoc ?? null,
          estimatedKcalActiveWithEpoc:
            calorieEstimate?.part.activeWithEpoc ?? null,
          estimatedKcalMethod: calorieEstimate?.part.method ?? null,
          estimatedKcalConfidence: calorieEstimate?.part.confidence ?? null,
        })
        .returning();

      if (normalizedDetails.length > 0) {
        await tx.insert(scoreMovementDetails).values(
          normalizedDetails
            .filter((d) => d.workoutMovementId)
            .map((d) => ({
              scoreId: inserted.id,
              workoutMovementId: d.workoutMovementId,
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

      return inserted;
    });

    // Invalidate insights cache for whichever user the score belongs to.
    await invalidateCrossfitInsightsCache(effectiveUserId);

    return NextResponse.json(score, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("unique") || message.includes("duplicate")) {
      return NextResponse.json(
        { error: "Score already logged for this part" },
        { status: 409 }
      );
    }
    throw err;
  }
}
