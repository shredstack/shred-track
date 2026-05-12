// ---------------------------------------------------------------------------
// Weightlifting benchmarks: shared helpers
// ---------------------------------------------------------------------------
//
// One benchmark per 1RM-applicable movement (anchored via
// benchmark_workouts.weightlifting_movement_id). The "1RM / 2RM / 3RM / 5RM"
// views are derived at query time from the athlete's for_load history.
//
// See claude_code_instructions/weightlifting_benchmarks_spec.md.

import { and, eq, isNotNull } from "drizzle-orm";
import {
  benchmarkWorkouts,
  benchmarkWorkoutMovements,
  benchmarkWorkoutParts,
  movements,
} from "@/db/schema";
import {
  parseRepScheme,
  type RepSchemeParsed,
} from "@/lib/crossfit/rep-scheme-parser";
import type { DB } from "@/db";

// A Drizzle transaction object has the same query surface as the db client
// for our purposes (select/insert/update/delete). Helpers accept either.
type TxOrDb = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];

export const REP_MAX_TARGETS = [1, 2, 3, 5] as const;
export type RepMaxTarget = (typeof REP_MAX_TARGETS)[number];

// ---------------------------------------------------------------------------
// Rep-max classification
// ---------------------------------------------------------------------------

const REP_MAX_SET = new Set<number>(REP_MAX_TARGETS);

function uniformReps(parsed: RepSchemeParsed | null): number | null {
  if (!parsed) return null;
  switch (parsed.kind) {
    case "fixed":
      return parsed.reps;
    case "sets":
      return parsed.reps;
    case "sequence": {
      if (parsed.reps.length === 0) return null;
      const first = parsed.reps[0];
      for (let i = 1; i < parsed.reps.length; i++) {
        if (parsed.reps[i] !== first) return null;
      }
      return first;
    }
    case "ladder":
      // Mixed reps across rounds — never a single rep-max attempt.
      return null;
  }
}

/**
 * Classify a workout part's rep_scheme as one of the supported rep-max
 * targets (1, 2, 3, 5) or null when it doesn't fit. Used to route a
 * for_load score into the right rep-max view, and to qualify a smart-built
 * workout for auto-linking to its movement's weightlifting benchmark.
 *
 * Accepts:
 *   "1", "2", "3", "5"       → fixed
 *   "5x5", "3×3", "5 x 1"    → sets (sets count is irrelevant; only reps)
 *   "5-5-5-5-5", "3-3-3"     → sequence of uniform reps
 * Rejects everything else (ladders, mixed sequences like "5-5-3-3-1",
 * "1RM"-style text the parser returns null for, etc.).
 */
export function inferRepMaxTarget(
  repScheme: string | null | undefined
): RepMaxTarget | null {
  const parsed = parseRepScheme(repScheme ?? null);
  const n = uniformReps(parsed);
  if (n != null && REP_MAX_SET.has(n)) return n as RepMaxTarget;
  return null;
}

// ---------------------------------------------------------------------------
// Inference: does this newly-built workout map to a weightlifting benchmark?
// ---------------------------------------------------------------------------

interface InferencePart {
  workoutType: string;
  repScheme: string | null | undefined;
  movementIds: string[];
}

/**
 * Determine whether the built workout qualifies for auto-linking to a
 * weightlifting benchmark. Returns the matched benchmark id + rep target,
 * or null when no rule fires.
 *
 * Qualifying shape (all must hold):
 *   - exactly one part, workoutType = 'for_load'
 *   - exactly one movement on that part, and that movement has
 *     is_1rm_applicable = true
 *   - rep scheme classifies to {1, 2, 3, 5} via inferRepMaxTarget
 *   - a benchmark row exists with weightlifting_movement_id = movement.id
 *
 * A single read confirms both the movement's applicability and the
 * benchmark's existence — callers don't need to pre-fetch movement state.
 */
export async function inferWeightliftingBenchmark(
  tx: TxOrDb,
  parts: InferencePart[]
): Promise<{ benchmarkId: string; repTarget: RepMaxTarget } | null> {
  if (parts.length !== 1) return null;
  const part = parts[0];
  if (part.workoutType !== "for_load") return null;
  if (part.movementIds.length !== 1) return null;

  const repTarget = inferRepMaxTarget(part.repScheme ?? null);
  if (!repTarget) return null;

  const movementId = part.movementIds[0];

  const [match] = await tx
    .select({ benchmarkId: benchmarkWorkouts.id })
    .from(benchmarkWorkouts)
    .innerJoin(
      movements,
      eq(movements.id, benchmarkWorkouts.weightliftingMovementId)
    )
    .where(
      and(
        eq(benchmarkWorkouts.weightliftingMovementId, movementId),
        eq(movements.is1rmApplicable, true)
      )
    )
    .limit(1);

  if (!match) return null;
  return { benchmarkId: match.benchmarkId, repTarget };
}

// ---------------------------------------------------------------------------
// Upsert: ensure a weightlifting benchmark row exists for a movement
// ---------------------------------------------------------------------------

interface MovementSeed {
  id: string;
  canonicalName: string;
}

/**
 * Idempotent upsert. Creates (or refreshes) the single benchmark row
 * anchored to `movement.id` plus its single part (workoutType=for_load,
 * no rep scheme — the rep target is per-workout, not per-benchmark) plus
 * its single movement row.
 *
 * Wrap callers in a transaction so an admin write that flips
 * is_1rm_applicable and the dependent benchmark upsert succeed or fail
 * together.
 */
export async function ensureWeightliftingBenchmark(
  tx: TxOrDb,
  movement: MovementSeed
): Promise<string> {
  const [existing] = await tx
    .select({ id: benchmarkWorkouts.id })
    .from(benchmarkWorkouts)
    .where(eq(benchmarkWorkouts.weightliftingMovementId, movement.id))
    .limit(1);

  let benchmarkId: string;

  if (existing) {
    benchmarkId = existing.id;
    await tx
      .update(benchmarkWorkouts)
      .set({
        name: movement.canonicalName,
        description: `Rep-max benchmark for ${movement.canonicalName} — track your 1RM, 2RM, 3RM, and 5RM in one place.`,
        workoutType: "for_load",
        category: "weightlifting",
        repScheme: null,
        isSystem: true,
        weightliftingMovementId: movement.id,
        updatedAt: new Date(),
      })
      .where(eq(benchmarkWorkouts.id, benchmarkId));

    // Rebuild parts + movements idempotently. Cascade removes the
    // benchmark_workout_movements rows.
    await tx
      .delete(benchmarkWorkoutParts)
      .where(eq(benchmarkWorkoutParts.benchmarkWorkoutId, benchmarkId));
    await tx
      .delete(benchmarkWorkoutMovements)
      .where(eq(benchmarkWorkoutMovements.benchmarkWorkoutId, benchmarkId));
  } else {
    const [inserted] = await tx
      .insert(benchmarkWorkouts)
      .values({
        name: movement.canonicalName,
        description: `Rep-max benchmark for ${movement.canonicalName} — track your 1RM, 2RM, 3RM, and 5RM in one place.`,
        workoutType: "for_load",
        category: "weightlifting",
        repScheme: null,
        isSystem: true,
        weightliftingMovementId: movement.id,
      })
      .returning({ id: benchmarkWorkouts.id });
    benchmarkId = inserted.id;
  }

  const [part] = await tx
    .insert(benchmarkWorkoutParts)
    .values({
      benchmarkWorkoutId: benchmarkId,
      orderIndex: 0,
      workoutType: "for_load",
    })
    .returning({ id: benchmarkWorkoutParts.id });

  await tx.insert(benchmarkWorkoutMovements).values({
    benchmarkWorkoutId: benchmarkId,
    benchmarkWorkoutPartId: part.id,
    movementId: movement.id,
    orderIndex: 0,
  });

  return benchmarkId;
}

// ---------------------------------------------------------------------------
// "Best per rep target" — like pickBestScore but bucketed by rep target
// ---------------------------------------------------------------------------

export interface RepTargetScore {
  scoreId: string;
  workoutDate: string;
  weightLbs: number | null;
  repTarget: RepMaxTarget;
}

/**
 * Bucket weighted scores by rep target and return the heaviest weight per
 * target. Stable: ties are broken by older `workoutDate` so an athlete who
 * matched a PR doesn't lose their original PR date.
 */
export function pickBestPerRepTarget(
  rows: RepTargetScore[]
): Record<RepMaxTarget, RepTargetScore | null> {
  const out: Record<RepMaxTarget, RepTargetScore | null> = {
    1: null,
    2: null,
    3: null,
    5: null,
  };
  for (const r of rows) {
    if (r.weightLbs == null) continue;
    const current = out[r.repTarget];
    if (
      !current ||
      r.weightLbs > (current.weightLbs ?? -Infinity) ||
      (r.weightLbs === current.weightLbs && r.workoutDate < current.workoutDate)
    ) {
      out[r.repTarget] = r;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// List helper — every weightlifting benchmark with its anchor movement id
// ---------------------------------------------------------------------------

/**
 * Pulls the (benchmarkId, movementId) pairs for every weightlifting
 * benchmark. Used by the list/detail endpoints to enrich the response with
 * per-rep-max stats without N+1 queries.
 */
export async function listWeightliftingBenchmarkAnchors(
  tx: TxOrDb
): Promise<Array<{ benchmarkId: string; movementId: string }>> {
  const rows = await tx
    .select({
      benchmarkId: benchmarkWorkouts.id,
      movementId: benchmarkWorkouts.weightliftingMovementId,
    })
    .from(benchmarkWorkouts)
    .where(
      and(
        isNotNull(benchmarkWorkouts.weightliftingMovementId),
        eq(benchmarkWorkouts.isSystem, true)
      )
    );
  return rows
    .filter((r): r is { benchmarkId: string; movementId: string } => !!r.movementId)
    .map((r) => ({ benchmarkId: r.benchmarkId, movementId: r.movementId }));
}
