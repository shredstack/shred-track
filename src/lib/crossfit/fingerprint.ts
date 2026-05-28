import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Content fingerprint for unified CrossFit workout templates.
//
// Two workouts with the same fingerprint within the same scope (user or
// community) are "the same workout" — repeated logs roll up under a single
// template and accumulate trend history.
//
// The hash is over the prescription only (movements, weights, reps, structure,
// time caps, partner/vest). Cosmetic fields (title, description, category,
// notes, calorie estimates, ids, timestamps) are excluded so two saves with
// the same prescription and different titles dedup to the same template.
//
// See claude_code_instructions/crossfit_improvements/unified_crossfit_workout_template_spec.md
// for the full algorithm contract.
// ---------------------------------------------------------------------------

export type FingerprintWorkoutLevel = {
  workoutType: string;
  timeCapSeconds?: number | null;
  amrapDurationSeconds?: number | null;
  repScheme?: string | null;
  rounds?: number | null;
  requiresVest?: boolean | null;
  vestWeightMaleLb?: number | string | null;
  vestWeightFemaleLb?: number | string | null;
  isPartner?: boolean | null;
  partnerCount?: number | null;
  weightliftingMovementId?: string | null;
};

export type FingerprintMovement = {
  movementId: string;
  orderIndex: number;
  // Order index of the parent block (or null if ungrouped). Two builds with
  // the same movements ordered differently *between blocks* must still
  // fingerprint differently, so block_order_index is part of the key.
  blockOrderIndex?: number | null;
  prescribedReps?: string | null;
  prescribedWeightMale?: number | string | null;
  prescribedWeightFemale?: number | string | null;
  prescribedCaloriesMale?: string | null;
  prescribedCaloriesFemale?: string | null;
  prescribedDistanceMale?: string | null;
  prescribedDistanceFemale?: string | null;
  prescribedDurationSecondsMale?: number | null;
  prescribedDurationSecondsFemale?: number | null;
  prescribedHeightInches?: number | string | null;
  prescribedHeightInchesMale?: number | string | null;
  prescribedHeightInchesFemale?: number | string | null;
  prescribedWeightMaleBwMultiplier?: number | string | null;
  prescribedWeightFemaleBwMultiplier?: number | string | null;
  prescribedWeightPct?: number | string | null;
  tempo?: string | null;
  isMaxReps?: boolean | null;
  isSideCadence?: boolean | null;
  equipmentCount?: number | null;
  rxStandard?: string | null;
};

export type FingerprintPart = {
  orderIndex: number;
  workoutType: string;
  timeCapSeconds?: number | null;
  amrapDurationSeconds?: number | null;
  emomIntervalSeconds?: number | null;
  repScheme?: string | null;
  rounds?: number | null;
  structure?: string | null;
  intervalWorkSeconds?: number | null;
  intervalRestSeconds?: number | null;
  intervalRounds?: unknown;
  sideCadenceIntervalSeconds?: number | null;
  sideCadenceOpenEnded?: boolean | null;
  movements: FingerprintMovement[];
};

export type FingerprintInput = {
  workout: FingerprintWorkoutLevel;
  parts: FingerprintPart[];
};

// Normalize a value to a canonical JSON-friendly shape:
//   - null / undefined / ""  → null
//   - numeric strings ("75.0", "75", " 75 ") → 75 (number)
//   - other strings → trimmed string
//   - booleans → boolean (unchanged)
//   - numbers → number (unchanged)
//   - arrays → array of normalized values
//   - objects → object with normalized values + sorted keys
function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (Number.isNaN(value) || !Number.isFinite(value)) return null;
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    // Postgres `numeric` columns come back as strings — coerce to number when
    // unambiguously numeric so "75.0" and 75 hash identically.
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isFinite(n)) return n;
    }
    return trimmed;
  }
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = normalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  // Functions, symbols, bigints — not expected in prescription data.
  return null;
}

function pickWorkoutLevel(w: FingerprintWorkoutLevel): Record<string, unknown> {
  return {
    workoutType: w.workoutType,
    timeCapSeconds: w.timeCapSeconds ?? null,
    amrapDurationSeconds: w.amrapDurationSeconds ?? null,
    repScheme: w.repScheme ?? null,
    rounds: w.rounds ?? null,
    requiresVest: w.requiresVest ?? false,
    vestWeightMaleLb: w.vestWeightMaleLb ?? null,
    vestWeightFemaleLb: w.vestWeightFemaleLb ?? null,
    isPartner: w.isPartner ?? false,
    partnerCount: w.partnerCount ?? null,
    weightliftingMovementId: w.weightliftingMovementId ?? null,
  };
}

function pickPartLevel(p: FingerprintPart): Record<string, unknown> {
  return {
    orderIndex: p.orderIndex,
    workoutType: p.workoutType,
    timeCapSeconds: p.timeCapSeconds ?? null,
    amrapDurationSeconds: p.amrapDurationSeconds ?? null,
    emomIntervalSeconds: p.emomIntervalSeconds ?? null,
    repScheme: p.repScheme ?? null,
    rounds: p.rounds ?? null,
    structure: p.structure ?? null,
    intervalWorkSeconds: p.intervalWorkSeconds ?? null,
    intervalRestSeconds: p.intervalRestSeconds ?? null,
    intervalRounds: p.intervalRounds ?? null,
    sideCadenceIntervalSeconds: p.sideCadenceIntervalSeconds ?? null,
    sideCadenceOpenEnded: p.sideCadenceOpenEnded ?? false,
  };
}

function pickMovementLevel(m: FingerprintMovement): Record<string, unknown> {
  return {
    movementId: m.movementId,
    orderIndex: m.orderIndex,
    blockOrderIndex: m.blockOrderIndex ?? null,
    prescribedReps: m.prescribedReps ?? null,
    prescribedWeightMale: m.prescribedWeightMale ?? null,
    prescribedWeightFemale: m.prescribedWeightFemale ?? null,
    prescribedCaloriesMale: m.prescribedCaloriesMale ?? null,
    prescribedCaloriesFemale: m.prescribedCaloriesFemale ?? null,
    prescribedDistanceMale: m.prescribedDistanceMale ?? null,
    prescribedDistanceFemale: m.prescribedDistanceFemale ?? null,
    prescribedDurationSecondsMale: m.prescribedDurationSecondsMale ?? null,
    prescribedDurationSecondsFemale: m.prescribedDurationSecondsFemale ?? null,
    prescribedHeightInches: m.prescribedHeightInches ?? null,
    prescribedHeightInchesMale: m.prescribedHeightInchesMale ?? null,
    prescribedHeightInchesFemale: m.prescribedHeightInchesFemale ?? null,
    prescribedWeightMaleBwMultiplier:
      m.prescribedWeightMaleBwMultiplier ?? null,
    prescribedWeightFemaleBwMultiplier:
      m.prescribedWeightFemaleBwMultiplier ?? null,
    prescribedWeightPct: m.prescribedWeightPct ?? null,
    tempo: m.tempo ?? null,
    isMaxReps: m.isMaxReps ?? false,
    isSideCadence: m.isSideCadence ?? false,
    equipmentCount: m.equipmentCount ?? null,
    rxStandard: m.rxStandard ?? null,
  };
}

function compareMovements(a: FingerprintMovement, b: FingerprintMovement): number {
  const aBlock = a.blockOrderIndex ?? -1;
  const bBlock = b.blockOrderIndex ?? -1;
  if (aBlock !== bBlock) return aBlock - bBlock;
  return a.orderIndex - b.orderIndex;
}

export function computeWorkoutFingerprint(input: FingerprintInput): string {
  const normalized = {
    w: pickWorkoutLevel(input.workout),
    parts: input.parts
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((part) => ({
        ...pickPartLevel(part),
        movements: part.movements
          .slice()
          .sort(compareMovements)
          .map(pickMovementLevel),
      })),
  };
  const canonical = JSON.stringify(normalize(normalized));
  return createHash("sha256").update(canonical).digest("hex");
}
