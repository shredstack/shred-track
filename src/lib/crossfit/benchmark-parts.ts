// Shared helpers for the benchmark API routes — input coercion, diffing,
// and read-shaping for the multi-part benchmark schema.
//
// The benchmark form (and admin form) send a `parts[]` payload that mirrors
// the workouts API. The legacy single-part shape (top-level workoutType,
// timeCapSeconds, repScheme on `benchmark_workouts`, plus a flat movements
// list) is kept on read for one release as a deprecated fallback so older
// renderers (preview cards, leaderboard headers) keep working.

import {
  benchmarkWorkoutMovements,
  benchmarkWorkoutParts,
  movements,
} from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  parseRepScheme,
  type RepSchemeParsed,
} from "@/lib/crossfit/rep-scheme-parser";
import { parseDurationToSeconds } from "@/lib/crossfit/duration-parser";
import type {
  BenchmarkMovement,
  BenchmarkWorkoutPart,
  IntervalRoundSpec,
  MovementCategory,
  MovementMetricType,
  WorkoutPartStructure,
  WorkoutType,
} from "@/types/crossfit";

// ============================================
// Input shapes
// ============================================

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
  isSideCadence?: boolean;
  equipmentCount?: number | null;
  rxStandard?: string | null;
  notes?: string | null;
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
  notes?: string | null;
  movements: BenchmarkPartMovementInput[];
}

// ============================================
// Coercion helpers
// ============================================

function toIntOrNull(value: number | string | undefined | null): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function toTextOrNull(
  value: number | string | undefined | null
): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

function toNumericOrNull(
  value: number | string | undefined | null
): string | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(n) || n < 0) return null;
  return String(n);
}

function toDurationSecondsOrNull(
  value: number | string | undefined | null
): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  }
  return parseDurationToSeconds(String(value));
}

function normalizeIntervalRounds(
  rounds: BenchmarkPartInput["intervalRounds"]
): { workSeconds: number; restSeconds: number }[] | null {
  if (!Array.isArray(rounds) || rounds.length === 0) return null;
  const out: { workSeconds: number; restSeconds: number }[] = [];
  for (const r of rounds) {
    const w = toDurationSecondsOrNull(r.workSeconds);
    const rest = toDurationSecondsOrNull(r.restSeconds);
    if (w == null || rest == null) return null;
    out.push({ workSeconds: w, restSeconds: rest });
  }
  return out;
}

export function coerceBenchmarkPartValues(part: BenchmarkPartInput) {
  return {
    label: part.label?.toString().trim() || null,
    workoutType: part.workoutType,
    timeCapSeconds: toIntOrNull(part.timeCapSeconds),
    amrapDurationSeconds: toIntOrNull(part.amrapDurationSeconds),
    emomIntervalSeconds: toIntOrNull(part.emomIntervalSeconds),
    repScheme: toTextOrNull(part.repScheme),
    rounds: toIntOrNull(part.rounds),
    structure: part.structure ?? null,
    intervalWorkSeconds: toDurationSecondsOrNull(part.intervalWorkSeconds),
    intervalRestSeconds: toDurationSecondsOrNull(part.intervalRestSeconds),
    intervalRounds: normalizeIntervalRounds(part.intervalRounds ?? null),
    sideCadenceIntervalSeconds: toDurationSecondsOrNull(
      part.sideCadenceIntervalSeconds
    ),
    sideCadenceOpenEnded: !!part.sideCadenceOpenEnded,
    notes: toTextOrNull(part.notes),
  };
}

export function coerceBenchmarkMovementValues(
  m: BenchmarkPartMovementInput,
  fallbackOrderIndex: number
) {
  const repSchemeParsed: RepSchemeParsed | null = parseRepScheme(
    m.prescribedReps ?? null
  );
  return {
    movementId: m.movementId,
    orderIndex: m.orderIndex ?? fallbackOrderIndex,
    prescribedReps: toTextOrNull(m.prescribedReps),
    prescribedWeightMale: toNumericOrNull(m.prescribedWeightMale),
    prescribedWeightFemale: toNumericOrNull(m.prescribedWeightFemale),
    prescribedCaloriesMale: toTextOrNull(m.prescribedCaloriesMale),
    prescribedCaloriesFemale: toTextOrNull(m.prescribedCaloriesFemale),
    prescribedDistanceMale: toTextOrNull(m.prescribedDistanceMale),
    prescribedDistanceFemale: toTextOrNull(m.prescribedDistanceFemale),
    prescribedDurationSecondsMale: toDurationSecondsOrNull(
      m.prescribedDurationSecondsMale
    ),
    prescribedDurationSecondsFemale: toDurationSecondsOrNull(
      m.prescribedDurationSecondsFemale
    ),
    prescribedHeightInches: toNumericOrNull(m.prescribedHeightInches),
    prescribedHeightInchesMale: toNumericOrNull(m.prescribedHeightInchesMale),
    prescribedHeightInchesFemale: toNumericOrNull(
      m.prescribedHeightInchesFemale
    ),
    prescribedWeightMaleBwMultiplier: toNumericOrNull(
      m.prescribedWeightMaleBwMultiplier
    ),
    prescribedWeightFemaleBwMultiplier: toNumericOrNull(
      m.prescribedWeightFemaleBwMultiplier
    ),
    tempo: toTextOrNull(m.tempo),
    isMaxReps: !!m.isMaxReps,
    isSideCadence: !!m.isSideCadence,
    repSchemeParsed,
    equipmentCount: toIntOrNull(m.equipmentCount),
    rxStandard: toTextOrNull(m.rxStandard),
    notes: toTextOrNull(m.notes),
  };
}

// ============================================
// Read shape — fetch parts + movements and assemble BenchmarkWorkoutPart[]
// ============================================

type RawBenchmarkWorkout = {
  id: string;
  workoutType: string;
  timeCapSeconds: number | null;
  amrapDurationSeconds: number | null;
  repScheme: string | null;
};

type FetchedPart = typeof benchmarkWorkoutParts.$inferSelect;
type FetchedMovementRow = {
  id: string;
  benchmarkWorkoutId: string;
  benchmarkWorkoutPartId: string | null;
  movementId: string;
  movementName: string;
  movementCategory: string;
  movementIsWeighted: boolean;
  movementMetricType: string;
  orderIndex: number;
  prescribedReps: string | null;
  prescribedWeightMale: string | null;
  prescribedWeightFemale: string | null;
  prescribedCaloriesMale: string | null;
  prescribedCaloriesFemale: string | null;
  prescribedDistanceMale: string | null;
  prescribedDistanceFemale: string | null;
  prescribedDurationSecondsMale: number | null;
  prescribedDurationSecondsFemale: number | null;
  prescribedHeightInches: string | null;
  prescribedHeightInchesMale: string | null;
  prescribedHeightInchesFemale: string | null;
  prescribedWeightMaleBwMultiplier: string | null;
  prescribedWeightFemaleBwMultiplier: string | null;
  tempo: string | null;
  isMaxReps: boolean;
  isSideCadence: boolean;
  equipmentCount: number | null;
  rxStandard: string | null;
  notes: string | null;
};

export async function fetchBenchmarkPartsAndMovements(benchmarkIds: string[]) {
  if (benchmarkIds.length === 0) {
    return {
      partsByBenchmark: new Map<string, FetchedPart[]>(),
      movementsByBenchmark: new Map<string, FetchedMovementRow[]>(),
    };
  }

  const allParts = await db
    .select()
    .from(benchmarkWorkoutParts)
    .where(inArray(benchmarkWorkoutParts.benchmarkWorkoutId, benchmarkIds))
    .orderBy(benchmarkWorkoutParts.orderIndex);

  const allMovements: FetchedMovementRow[] = await db
    .select({
      id: benchmarkWorkoutMovements.id,
      benchmarkWorkoutId: benchmarkWorkoutMovements.benchmarkWorkoutId,
      benchmarkWorkoutPartId: benchmarkWorkoutMovements.benchmarkWorkoutPartId,
      movementId: benchmarkWorkoutMovements.movementId,
      movementName: movements.canonicalName,
      movementCategory: movements.category,
      movementIsWeighted: movements.isWeighted,
      movementMetricType: movements.metricType,
      orderIndex: benchmarkWorkoutMovements.orderIndex,
      prescribedReps: benchmarkWorkoutMovements.prescribedReps,
      prescribedWeightMale: benchmarkWorkoutMovements.prescribedWeightMale,
      prescribedWeightFemale: benchmarkWorkoutMovements.prescribedWeightFemale,
      prescribedCaloriesMale:
        benchmarkWorkoutMovements.prescribedCaloriesMale,
      prescribedCaloriesFemale:
        benchmarkWorkoutMovements.prescribedCaloriesFemale,
      prescribedDistanceMale: benchmarkWorkoutMovements.prescribedDistanceMale,
      prescribedDistanceFemale:
        benchmarkWorkoutMovements.prescribedDistanceFemale,
      prescribedDurationSecondsMale:
        benchmarkWorkoutMovements.prescribedDurationSecondsMale,
      prescribedDurationSecondsFemale:
        benchmarkWorkoutMovements.prescribedDurationSecondsFemale,
      prescribedHeightInches: benchmarkWorkoutMovements.prescribedHeightInches,
      prescribedHeightInchesMale:
        benchmarkWorkoutMovements.prescribedHeightInchesMale,
      prescribedHeightInchesFemale:
        benchmarkWorkoutMovements.prescribedHeightInchesFemale,
      prescribedWeightMaleBwMultiplier:
        benchmarkWorkoutMovements.prescribedWeightMaleBwMultiplier,
      prescribedWeightFemaleBwMultiplier:
        benchmarkWorkoutMovements.prescribedWeightFemaleBwMultiplier,
      tempo: benchmarkWorkoutMovements.tempo,
      isMaxReps: benchmarkWorkoutMovements.isMaxReps,
      isSideCadence: benchmarkWorkoutMovements.isSideCadence,
      equipmentCount: benchmarkWorkoutMovements.equipmentCount,
      rxStandard: benchmarkWorkoutMovements.rxStandard,
      notes: benchmarkWorkoutMovements.notes,
    })
    .from(benchmarkWorkoutMovements)
    .innerJoin(
      movements,
      eq(benchmarkWorkoutMovements.movementId, movements.id)
    )
    .where(
      inArray(benchmarkWorkoutMovements.benchmarkWorkoutId, benchmarkIds)
    )
    .orderBy(benchmarkWorkoutMovements.orderIndex);

  const partsByBenchmark = new Map<string, FetchedPart[]>();
  for (const p of allParts) {
    const list = partsByBenchmark.get(p.benchmarkWorkoutId) ?? [];
    list.push(p);
    partsByBenchmark.set(p.benchmarkWorkoutId, list);
  }

  const movementsByBenchmark = new Map<string, FetchedMovementRow[]>();
  for (const m of allMovements) {
    const list = movementsByBenchmark.get(m.benchmarkWorkoutId) ?? [];
    list.push(m);
    movementsByBenchmark.set(m.benchmarkWorkoutId, list);
  }

  return { partsByBenchmark, movementsByBenchmark };
}

function shapeMovement(m: FetchedMovementRow): BenchmarkMovement {
  return {
    id: m.id,
    movementId: m.movementId,
    movementName: m.movementName,
    category: m.movementCategory as MovementCategory,
    isWeighted: m.movementIsWeighted,
    metricType: m.movementMetricType as MovementMetricType,
    orderIndex: m.orderIndex,
    prescribedReps: m.prescribedReps,
    prescribedWeightMale:
      m.prescribedWeightMale != null ? Number(m.prescribedWeightMale) : null,
    prescribedWeightFemale:
      m.prescribedWeightFemale != null
        ? Number(m.prescribedWeightFemale)
        : null,
    prescribedCaloriesMale: m.prescribedCaloriesMale,
    prescribedCaloriesFemale: m.prescribedCaloriesFemale,
    prescribedDistanceMale: m.prescribedDistanceMale,
    prescribedDistanceFemale: m.prescribedDistanceFemale,
    prescribedDurationSecondsMale: m.prescribedDurationSecondsMale,
    prescribedDurationSecondsFemale: m.prescribedDurationSecondsFemale,
    prescribedHeightInches:
      m.prescribedHeightInches != null
        ? Number(m.prescribedHeightInches)
        : null,
    prescribedHeightInchesMale:
      m.prescribedHeightInchesMale != null
        ? Number(m.prescribedHeightInchesMale)
        : null,
    prescribedHeightInchesFemale:
      m.prescribedHeightInchesFemale != null
        ? Number(m.prescribedHeightInchesFemale)
        : null,
    prescribedWeightMaleBwMultiplier:
      m.prescribedWeightMaleBwMultiplier != null
        ? Number(m.prescribedWeightMaleBwMultiplier)
        : null,
    prescribedWeightFemaleBwMultiplier:
      m.prescribedWeightFemaleBwMultiplier != null
        ? Number(m.prescribedWeightFemaleBwMultiplier)
        : null,
    tempo: m.tempo,
    isMaxReps: m.isMaxReps,
    isSideCadence: m.isSideCadence,
    equipmentCount: m.equipmentCount,
    rxStandard: m.rxStandard,
    notes: m.notes,
  };
}

// Assemble the public `parts[]` payload for one benchmark, falling back to a
// synthetic single-part wrapper when no parts rows exist (legacy /
// un-backfilled data).
export function assembleBenchmarkParts(
  benchmark: RawBenchmarkWorkout,
  partsForBenchmark: FetchedPart[],
  movementsForBenchmark: FetchedMovementRow[]
): { parts: BenchmarkWorkoutPart[]; flatMovements: BenchmarkMovement[] } {
  const movementsByPart = new Map<string | null, FetchedMovementRow[]>();
  for (const m of movementsForBenchmark) {
    const key = m.benchmarkWorkoutPartId;
    const list = movementsByPart.get(key) ?? [];
    list.push(m);
    movementsByPart.set(key, list);
  }

  const parts: BenchmarkWorkoutPart[] = [];

  if (partsForBenchmark.length > 0) {
    for (const p of partsForBenchmark) {
      const movs = movementsByPart.get(p.id) ?? [];
      parts.push({
        id: p.id,
        orderIndex: p.orderIndex,
        label: p.label,
        workoutType: p.workoutType as WorkoutType,
        timeCapSeconds: p.timeCapSeconds,
        amrapDurationSeconds: p.amrapDurationSeconds,
        emomIntervalSeconds: p.emomIntervalSeconds,
        repScheme: p.repScheme,
        rounds: p.rounds,
        structure: (p.structure as WorkoutPartStructure | null) ?? null,
        intervalWorkSeconds: p.intervalWorkSeconds,
        intervalRestSeconds: p.intervalRestSeconds,
        intervalRounds: (p.intervalRounds as IntervalRoundSpec[] | null) ?? null,
        sideCadenceIntervalSeconds: p.sideCadenceIntervalSeconds,
        sideCadenceOpenEnded: p.sideCadenceOpenEnded,
        notes: p.notes,
        movements: movs.map(shapeMovement),
      });
    }
  } else {
    // Synthetic one-part wrap: mirror the benchmark's legacy top-level
    // columns and attach all movements (which won't have a part FK on
    // legacy data).
    const movs = movementsForBenchmark;
    parts.push({
      id: `synthetic:${benchmark.id}`,
      orderIndex: 0,
      label: null,
      workoutType: benchmark.workoutType as WorkoutType,
      timeCapSeconds: benchmark.timeCapSeconds,
      amrapDurationSeconds: benchmark.amrapDurationSeconds,
      emomIntervalSeconds: null,
      repScheme: benchmark.repScheme,
      rounds: null,
      structure: null,
      intervalWorkSeconds: null,
      intervalRestSeconds: null,
      intervalRounds: null,
      sideCadenceIntervalSeconds: null,
      sideCadenceOpenEnded: false,
      notes: null,
      movements: movs.map(shapeMovement),
    });
  }

  // Flat movement list (deprecated): mirrors the first part's movements so
  // legacy renderers keep working. Sorted by orderIndex.
  const flatMovements = [...(parts[0]?.movements ?? [])].sort(
    (a, b) => a.orderIndex - b.orderIndex
  );

  return { parts, flatMovements };
}
