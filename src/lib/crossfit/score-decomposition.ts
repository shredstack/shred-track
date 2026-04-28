// ============================================
// AMRAP Score Decomposition
// ============================================
//
// Turns "4 + 6" on an AMRAP into structured per-round and per-movement
// breakdown. Requires the part to carry parsed rep schemes; degrades
// gracefully (returns null shaped data + a flag) when a movement lacks the
// parsed shape.

import {
  repsForRound,
  type RepSchemeParsed,
} from "@/lib/crossfit/rep-scheme-parser";
import type {
  WorkoutPartDisplay,
  WorkoutMovementDisplay,
  ScoreDisplay,
} from "@/types/crossfit";

export type AthleteGender = "M" | "F";

export type DecomposedRound = {
  roundIndex: number; // 0-based
  full: boolean; // true when the athlete completed every movement in this round
  movements: {
    workoutMovementId: string;
    movementName: string;
    prescribed: number; // reps / cals / meters prescribed for this round
    completed: number; // what the athlete actually did
    unit: "reps" | "cal" | "m";
  }[];
};

export type DecomposedScore = {
  completedRounds: number;
  partialMovementId?: string;
  partialMovementName?: string;
  partialReps?: number;
  partialPrescribed?: number;
  partialUnit?: "reps" | "cal" | "m";
  rounds: DecomposedRound[]; // includes the partial as the last entry when applicable
  perMovementTotals: {
    workoutMovementId: string;
    movementName: string;
    total: number;
    unit: "reps" | "cal" | "m";
  }[];
  genderUncertain: boolean;
};

// Resolve the prescribed quantity for a movement on a given (zero-based)
// round, and its unit. Falls back to a per-movement fixed value if the rep
// scheme isn't parsed (e.g. straight numeric like "12").
function prescribedForMovement(
  mov: WorkoutMovementDisplay,
  roundIndex: number,
  gender: AthleteGender
): { value: number; unit: "reps" | "cal" | "m"; certain: boolean } | null {
  const m = mov.metricType;
  if (m === "calories") {
    const v = pickGendered(
      mov.prescribedCaloriesMale,
      mov.prescribedCaloriesFemale,
      gender
    );
    if (v == null) return null;
    return { value: v.value, unit: "cal", certain: v.certain };
  }
  if (m === "distance") {
    const v = pickGendered(
      mov.prescribedDistanceMale,
      mov.prescribedDistanceFemale,
      gender
    );
    if (v == null) return null;
    return { value: v.value, unit: "m", certain: v.certain };
  }
  // reps / weight: round walking comes from the parsed scheme. If the
  // movement has no parsed scheme, try to interpret the prescribedReps as
  // a flat number (e.g. "12"). Failing that, return null and the caller
  // marks the round as "unknown" for this movement.
  const parsed = mov.repSchemeParsed;
  if (parsed) {
    return { value: repsForRound(parsed, roundIndex), unit: "reps", certain: true };
  }
  if (mov.prescribedReps && /^\d+$/.test(mov.prescribedReps.trim())) {
    return {
      value: parseInt(mov.prescribedReps.trim(), 10),
      unit: "reps",
      certain: true,
    };
  }
  return null;
}

// Pick the gendered value with a fallback chain matching §7.3:
//   - explicit gender match
//   - the other gender's value (with certain=false)
//   - null
function pickGendered(
  male: number | null | undefined,
  female: number | null | undefined,
  gender: AthleteGender
): { value: number; certain: boolean } | null {
  const own = gender === "M" ? male : female;
  const other = gender === "M" ? female : male;
  if (own != null) return { value: own, certain: true };
  if (other != null) return { value: other, certain: false };
  return null;
}

/**
 * Decompose an AMRAP score (rounds + remainder) into a per-round walk and
 * per-movement totals. Returns null when the part isn't an AMRAP or the
 * score lacks rounds — caller falls back to the existing `R + r` display.
 */
export function decomposeAmrapScore(
  part: WorkoutPartDisplay,
  score: ScoreDisplay,
  gender: AthleteGender | null
): DecomposedScore | null {
  if (part.workoutType !== "amrap") return null;
  if (score.rounds == null && (score.remainderReps == null || score.remainderReps === 0)) {
    return null;
  }
  if (part.movements.length === 0) return null;

  const effectiveGender: AthleteGender = gender ?? "M";
  const genderUncertain = gender == null;

  const fullRounds = score.rounds ?? 0;
  const rounds: DecomposedRound[] = [];

  // Walk the completed rounds (0..fullRounds-1).
  let anyUncertain = genderUncertain;
  for (let i = 0; i < fullRounds; i++) {
    const movs = part.movements.map((mov) => {
      const p = prescribedForMovement(mov, i, effectiveGender);
      if (!p) {
        anyUncertain = true;
        return {
          workoutMovementId: mov.id,
          movementName: mov.movementName,
          prescribed: 0,
          completed: 0,
          unit: "reps" as const,
        };
      }
      if (!p.certain) anyUncertain = true;
      return {
        workoutMovementId: mov.id,
        movementName: mov.movementName,
        prescribed: p.value,
        completed: p.value,
        unit: p.unit,
      };
    });
    rounds.push({ roundIndex: i, full: true, movements: movs });
  }

  // Partial round — walk movements in order, draining `remainder`.
  let partialMovementId: string | undefined;
  let partialMovementName: string | undefined;
  let partialReps: number | undefined;
  let partialPrescribed: number | undefined;
  let partialUnit: "reps" | "cal" | "m" | undefined;

  const remainder = score.remainderReps ?? 0;
  if (remainder > 0) {
    let left = remainder;
    const partialMovs: DecomposedRound["movements"] = [];
    for (const mov of part.movements) {
      const p = prescribedForMovement(mov, fullRounds, effectiveGender);
      if (!p) {
        anyUncertain = true;
        partialMovs.push({
          workoutMovementId: mov.id,
          movementName: mov.movementName,
          prescribed: 0,
          completed: left > 0 ? left : 0,
          unit: "reps",
        });
        // Without a known prescribed value we can't keep walking — bail.
        partialMovementId = mov.id;
        partialMovementName = mov.movementName;
        partialReps = left;
        partialPrescribed = undefined;
        partialUnit = "reps";
        left = 0;
        break;
      }
      if (!p.certain) anyUncertain = true;
      const taken = Math.min(left, p.value);
      partialMovs.push({
        workoutMovementId: mov.id,
        movementName: mov.movementName,
        prescribed: p.value,
        completed: taken,
        unit: p.unit,
      });
      left -= taken;
      if (taken < p.value) {
        partialMovementId = mov.id;
        partialMovementName = mov.movementName;
        partialReps = taken;
        partialPrescribed = p.value;
        partialUnit = p.unit;
        break;
      }
    }
    rounds.push({ roundIndex: fullRounds, full: false, movements: partialMovs });
  }

  // Aggregate per-movement totals across all rounds.
  const totalsByMov = new Map<
    string,
    { movementName: string; total: number; unit: "reps" | "cal" | "m" }
  >();
  for (const r of rounds) {
    for (const m of r.movements) {
      const cur = totalsByMov.get(m.workoutMovementId);
      if (cur) {
        cur.total += m.completed;
      } else {
        totalsByMov.set(m.workoutMovementId, {
          movementName: m.movementName,
          total: m.completed,
          unit: m.unit,
        });
      }
    }
  }

  return {
    completedRounds: fullRounds,
    partialMovementId,
    partialMovementName,
    partialReps,
    partialPrescribed,
    partialUnit,
    rounds,
    perMovementTotals: Array.from(totalsByMov.entries()).map(([id, v]) => ({
      workoutMovementId: id,
      movementName: v.movementName,
      total: v.total,
      unit: v.unit,
    })),
    genderUncertain: anyUncertain,
  };
}

// Re-export RepSchemeParsed for convenience to consumers of this module.
export type { RepSchemeParsed };
