import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  scores,
  scoreMovementDetails,
  workouts,
  workoutParts,
} from "@/db/schema";
import { eq, desc, asc } from "drizzle-orm";
import { getSessionUser } from "@/lib/session";
import { normalizeSetEntries } from "@/lib/crossfit/set-entries";
import type { SetEntry } from "@/types/crossfit";

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
  notes?: string;
}

interface ScorePostBody {
  workoutId?: string;
  workoutPartId?: string;
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

  try {
    const score = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(scores)
        .values({
          workoutId: workoutId!,
          workoutPartId,
          userId: user.id,
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
              notes: d.notes ?? null,
            }))
        );
      }

      return inserted;
    });

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
