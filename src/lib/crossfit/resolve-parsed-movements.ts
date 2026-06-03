// Resolves a ParsedWorkout (paste-tab output) into a CreatePartInput that
// the workouts and section-content APIs accept. Movements are matched
// against the user's movement library by canonical name; missing ones are
// created as user-scoped custom movements so the save always succeeds.
//
// Shared between the CrossFit tab (paste → new workout) and the gym
// programming flow (paste → section content) so resolution rules can't
// drift between callers.

import type { CreatePartInput } from "@/hooks/useWorkouts";
import type {
  MovementOption,
  ParsedMovement,
  ParsedWorkout,
} from "@/types/crossfit";

export interface ResolveOptions {
  movementLibrary: MovementOption[];
  createMovement: (input: { canonicalName: string }) => Promise<MovementOption>;
}

async function resolveMovementId(
  parsed: ParsedMovement,
  { movementLibrary, createMovement }: ResolveOptions
): Promise<MovementOption | null> {
  const targetName = (parsed.matchedCanonicalName || parsed.name).trim();
  if (!targetName) return null;
  const match = movementLibrary.find(
    (m) => m.canonicalName.toLowerCase() === targetName.toLowerCase()
  );
  if (match) return match;
  try {
    return await createMovement({ canonicalName: targetName });
  } catch {
    return null;
  }
}

export interface ResolvedParsedPart {
  part: CreatePartInput;
  resolvedCount: number;
  totalCount: number;
}

// Resolves all movement names → ids and builds a single CreatePartInput.
// Returns null if no movements could be resolved (caller should surface an
// error). Callers that want to know about partial resolution can read
// `resolvedCount` / `totalCount`.
export async function resolveParsedToCreatePart(
  parsed: ParsedWorkout,
  options: ResolveOptions
): Promise<ResolvedParsedPart | null> {
  const resolved = await Promise.all(
    parsed.movements.map(async (m) => ({
      parsed: m,
      movement: await resolveMovementId(m, options),
    }))
  );

  const usable = resolved.filter((r) => r.movement !== null);
  if (usable.length === 0) return null;

  const part: CreatePartInput = {
    workoutType: parsed.workoutType,
    timeCapSeconds: parsed.timeCapSeconds,
    amrapDurationSeconds: parsed.amrapDurationSeconds,
    repScheme: parsed.repScheme,
    // Timed Rounds: forward rounds + per-round window + aggregation so the
    // pasted "Every 5:00 for 5 rounds — score is slowest" survives the
    // text → API round-trip.
    rounds: parsed.rounds,
    roundScoreAggregation: parsed.roundScoreAggregation,
    roundWindowSeconds: parsed.roundWindowSeconds,
    movements: usable.map((r, i) => ({
      movementId: r.movement!.id,
      orderIndex: i,
      // For cal/distance movements, the parser populates dedicated fields
      // and leaves `reps` empty so we don't double-write "21 Cal" into
      // prescribedReps for a calorie-typed movement.
      prescribedReps: r.parsed.reps,
      prescribedWeightMale: r.parsed.weightMale,
      prescribedWeightFemale: r.parsed.weightFemale,
      prescribedCaloriesMale: r.parsed.caloriesMale,
      prescribedCaloriesFemale: r.parsed.caloriesFemale,
      prescribedDistanceMale: r.parsed.distanceMaleMeters,
      prescribedDistanceFemale: r.parsed.distanceFemaleMeters,
    })),
  };

  return {
    part,
    resolvedCount: usable.length,
    totalCount: parsed.movements.length,
  };
}

