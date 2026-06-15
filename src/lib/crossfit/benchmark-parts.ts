// Input shapes for the admin benchmark routes. The DB read/write paths
// now go through `upsert-template.ts` + `session-reader.ts` — these
// types stay here as the wire contract for /api/admin/benchmarks since
// the admin form was written before the unified-schema rename.

import type {
  WorkoutPartStructure,
  WorkoutType,
} from "@/types/crossfit";

export interface BenchmarkPartMovementInput {
  id?: string;
  movementId: string;
  orderIndex?: number;
  prescribedReps?: string | null;
  prescribedWeightMale?: number | string | null;
  prescribedWeightFemale?: number | string | null;
  prescribedCaloriesMale?: number | string | null;
  prescribedCaloriesFemale?: number | string | null;
  prescribedDistanceMale?: number | string | null;
  prescribedDistanceFemale?: number | string | null;
  prescribedDurationSecondsMale?: number | string | null;
  prescribedDurationSecondsFemale?: number | string | null;
  prescribedHeightInches?: number | string | null;
  prescribedHeightInchesMale?: number | string | null;
  prescribedHeightInchesFemale?: number | string | null;
  prescribedWeightMaleBwMultiplier?: number | string | null;
  prescribedWeightFemaleBwMultiplier?: number | string | null;
  tempo?: string | null;
  isMaxReps?: boolean;
  captureDurationPerRound?: boolean;
  isSideCadence?: boolean;
  slotIndex?: number | null;
  equipmentCount?: number | null;
  rxStandard?: string | null;
  notes?: string | null;
  blockId?: string | null;
  blockTempRef?: string | null;
}

export interface BenchmarkBlockInput {
  id?: string;
  tempRef?: string | null;
  title: string;
  orderIndex?: number;
}

export interface BenchmarkPartInput {
  id?: string;
  label?: string | null;
  workoutType: WorkoutType;
  timeCapSeconds?: number | null;
  amrapDurationSeconds?: number | null;
  emomIntervalSeconds?: number | null;
  repScheme?: string | null;
  rounds?: number | null;
  structure?: WorkoutPartStructure | null;
  intervalWorkSeconds?: number | string | null;
  intervalRestSeconds?: number | string | null;
  intervalRounds?:
    | { workSeconds: number | string; restSeconds: number | string }[]
    | null;
  sideCadenceIntervalSeconds?: number | string | null;
  sideCadenceOpenEnded?: boolean;
  // Timed Rounds — aggregation strategy + optional per-round window.
  roundScoreAggregation?:
    | "slowest"
    | "fastest"
    | "sum"
    | "average"
    | null;
  roundWindowSeconds?: number | string | null;
  notes?: string | null;
  movements: BenchmarkPartMovementInput[];
  blocks?: BenchmarkBlockInput[];
}
