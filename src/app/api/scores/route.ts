import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  communityMemberships,
  familyMembers,
  scores,
  scoreMovementDetails,
  workouts,
  workoutParts,
} from "@/db/schema";
import { and, eq, desc, asc } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { normalizeSetEntries } from "@/lib/crossfit/set-entries";
import { invalidateCrossfitInsightsCache } from "@/lib/crossfit/insights/cache";
import type { SetEntry } from "@/types/crossfit";
import { computeScoreEstimate } from "@/lib/calories/orchestrator";

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
  workoutId?: string;
  workoutPartId?: string;
  // Dependents (family_memberships): account holder logging on behalf
  // of a dependent. When set, the row's user_id is the dependent's id
  // (must be a family_members.dependent_user_id of the caller in the
  // workout's gym). When null, the row's user_id is the caller.
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

// POST /api/scores — log a score against a workout part
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as ScorePostBody;
  const { workoutId: rawWorkoutId, workoutPartId: rawPartId, division } = body;

  if (!division) {
    return NextResponse.json({ error: "division is required" }, { status: 400 });
  }

  // Resolve workoutId + workoutPartId. A legacy client that sends only
  // workoutId gets auto-resolved to that workout's first part (pre-multi-part
  // workouts always have exactly one part).
  let workoutId = rawWorkoutId;
  let workoutPartId = rawPartId;

  if (!workoutPartId) {
    if (!workoutId) {
      return NextResponse.json(
        { error: "workoutPartId or workoutId is required" },
        { status: 400 }
      );
    }
    const [firstPart] = await db
      .select({ id: workoutParts.id, workoutId: workoutParts.workoutId })
      .from(workoutParts)
      .where(eq(workoutParts.workoutId, workoutId))
      .orderBy(asc(workoutParts.orderIndex))
      .limit(1);
    if (!firstPart) {
      return NextResponse.json({ error: "Workout has no parts" }, { status: 400 });
    }
    workoutPartId = firstPart.id;
  } else if (!workoutId) {
    const [part] = await db
      .select({ workoutId: workoutParts.workoutId })
      .from(workoutParts)
      .where(eq(workoutParts.id, workoutPartId))
      .limit(1);
    if (!part) {
      return NextResponse.json({ error: "Part not found" }, { status: 404 });
    }
    workoutId = part.workoutId;
  }

  // Resolve effective user_id. "Log for" override (spec §8) lets an
  // account holder log scores on behalf of a dependent in the same gym.
  let effectiveUserId = user.id;
  if (body.forUserId && body.forUserId !== user.id) {
    const [w] = await db
      .select({ communityId: workouts.communityId })
      .from(workouts)
      .where(eq(workouts.id, workoutId!))
      .limit(1);
    if (!w?.communityId) {
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
          eq(familyMembers.communityId, w.communityId)
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
          eq(communityMemberships.communityId, w.communityId),
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

  // Compute the personalized calorie estimate before opening the transaction.
  // Worth noting: this issues a handful of read queries (parts, movements,
  // paces, user, community pref). All reads — safe outside the tx.
  let calorieEstimate: Awaited<ReturnType<typeof computeScoreEstimate>> | null =
    null;
  try {
    calorieEstimate = await computeScoreEstimate({
      workoutId: workoutId!,
      userId: effectiveUserId,
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
          workoutId: workoutId!,
          workoutPartId,
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
          estimatedKcal: calorieEstimate?.estimate.gross ?? null,
          estimatedKcalActive: calorieEstimate?.estimate.active ?? null,
          estimatedKcalWithEpoc: calorieEstimate?.estimate.grossWithEpoc ?? null,
          estimatedKcalActiveWithEpoc:
            calorieEstimate?.estimate.activeWithEpoc ?? null,
          estimatedKcalMethod: calorieEstimate?.estimate.method ?? null,
          estimatedKcalConfidence: calorieEstimate?.estimate.confidence ?? null,
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
