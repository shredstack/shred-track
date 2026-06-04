// GET /api/crossfit/templates/[id]/suggested-weights
//
// Returns a per-(part, crossfit_workout_movement) suggestion for every
// weighted movement on the template. Powers the "You: X–Y lb" chips on
// the workout card.
//
// Auth required. Suggestions are personalized to the calling user.

import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  crossfitWorkoutMovements,
  crossfitWorkoutParts,
  crossfitWorkouts,
  movements,
  users,
} from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import {
  suggestWeightsForPart,
  type MovementSuggestionInput,
  type PartSuggestionInput,
} from "@/lib/crossfit/suggested-weight";
import type { StimulusClass } from "@/db/schema";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [template] = await db
    .select({ id: crossfitWorkouts.id })
    .from(crossfitWorkouts)
    .where(eq(crossfitWorkouts.id, id))
    .limit(1);
  if (!template) {
    return NextResponse.json(
      { error: "Template not found" },
      { status: 404 }
    );
  }

  // Load parts + movements (joined with movement catalog) in one round trip.
  const parts = await db
    .select()
    .from(crossfitWorkoutParts)
    .where(eq(crossfitWorkoutParts.crossfitWorkoutId, id))
    .orderBy(asc(crossfitWorkoutParts.orderIndex));

  const movementRows = await db
    .select({
      id: crossfitWorkoutMovements.id,
      crossfitWorkoutPartId: crossfitWorkoutMovements.crossfitWorkoutPartId,
      crossfitWorkoutId: crossfitWorkoutMovements.crossfitWorkoutId,
      movementId: crossfitWorkoutMovements.movementId,
      category: movements.category,
      isWeighted: movements.isWeighted,
      is1rmApplicable: movements.is1rmApplicable,
      rxStimulusClass: movements.rxStimulusClass,
      commonRxWeightMale: movements.commonRxWeightMale,
      commonRxWeightFemale: movements.commonRxWeightFemale,
      prescribedWeightMale: crossfitWorkoutMovements.prescribedWeightMale,
      prescribedWeightFemale: crossfitWorkoutMovements.prescribedWeightFemale,
    })
    .from(crossfitWorkoutMovements)
    .innerJoin(movements, eq(movements.id, crossfitWorkoutMovements.movementId))
    .where(eq(crossfitWorkoutMovements.crossfitWorkoutId, id));

  const movementsByPart = new Map<string, typeof movementRows>();
  for (const m of movementRows) {
    const list = movementsByPart.get(m.crossfitWorkoutPartId) ?? [];
    list.push(m);
    movementsByPart.set(m.crossfitWorkoutPartId, list);
  }

  // Gender is stored on users; load it once for the per-movement Rx
  // fallback (only meaningful when no other signal exists).
  const [userRow] = await db
    .select({ gender: users.gender })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  const ctx = { id: user.id, gender: userRow?.gender ?? null };

  const partResults: Array<{
    partId: string;
    suggestions: Record<string, ReturnType<typeof shapeSuggestion>>;
  }> = [];

  for (const part of parts) {
    const partMovements = movementsByPart.get(part.id) ?? [];
    const input: PartSuggestionInput = {
      workoutType: part.workoutType,
      timeCapSeconds: part.timeCapSeconds,
      amrapDurationSeconds: part.amrapDurationSeconds,
      emomIntervalSeconds: part.emomIntervalSeconds,
      rounds: part.rounds,
      repScheme: part.repScheme,
      intervalRounds: (part.intervalRounds ?? null) as PartSuggestionInput["intervalRounds"],
      intervalWorkSeconds: part.intervalWorkSeconds,
      intervalRestSeconds: part.intervalRestSeconds,
      movementCategories: partMovements.map((m) => m.category),
      movements: partMovements.map<MovementSuggestionInput>((m) => ({
        crossfitWorkoutMovementId: m.id,
        crossfitWorkoutId: m.crossfitWorkoutId,
        movementId: m.movementId,
        movementCategory: m.category,
        is1rmApplicable: m.is1rmApplicable,
        isWeighted: m.isWeighted,
        rxStimulusClass: (m.rxStimulusClass ?? null) as StimulusClass | null,
        commonRxWeightMale:
          m.commonRxWeightMale != null ? Number(m.commonRxWeightMale) : null,
        commonRxWeightFemale:
          m.commonRxWeightFemale != null
            ? Number(m.commonRxWeightFemale)
            : null,
        prescribedWeightMale:
          m.prescribedWeightMale != null
            ? Number(m.prescribedWeightMale)
            : null,
        prescribedWeightFemale:
          m.prescribedWeightFemale != null
            ? Number(m.prescribedWeightFemale)
            : null,
      })),
    };

    const suggestions = await suggestWeightsForPart(ctx, input);
    const shaped: Record<string, ReturnType<typeof shapeSuggestion>> = {};
    for (const [cwmId, s] of suggestions) {
      shaped[cwmId] = shapeSuggestion(s);
    }
    partResults.push({ partId: part.id, suggestions: shaped });
  }

  return NextResponse.json({ templateId: id, parts: partResults });
}

function shapeSuggestion(s: {
  method: string;
  confidence: string;
  lowLb: number;
  highLb: number;
  anchor1rmLb?: number | null;
  anchorSource?: string | null;
  stimulusClass: string | null;
  priorContext?: {
    workoutDate: string;
    priorPrescribedLb: number | null;
    priorActualLb: number;
    rpe: number | null;
    workoutTemplateTitle: string | null;
  } | null;
}) {
  return {
    method: s.method,
    confidence: s.confidence,
    lowLb: s.lowLb,
    highLb: s.highLb,
    anchor1rmLb: s.anchor1rmLb ?? null,
    anchorSource: s.anchorSource ?? null,
    stimulusClass: s.stimulusClass,
    priorContext: s.priorContext ?? null,
  };
}
