// ---------------------------------------------------------------------------
// Weightlifting benchmarks: shared helpers
// ---------------------------------------------------------------------------
//
// One benchmark template per 1RM-applicable movement (anchored via
// crossfit_workouts.weightlifting_movement_id). The "1RM / 2RM / 3RM / 5RM"
// views are derived at query time from the athlete's for_load history.
//
// Unified-schema version: every weightlifting benchmark is a system template
// in `crossfit_workouts` with `is_benchmark = true, is_system = true`, a
// single for_load part, and a single movement on that part. Sessions logged
// against the template carry the athlete's score; the rep target is derived
// from each session's prescription rather than baked into the benchmark.
//
// See claude_code_instructions/weightlifting_benchmarks_spec.md.

import { and, eq, isNotNull } from "drizzle-orm";
import {
  crossfitWorkoutMovements,
  crossfitWorkoutParts,
  crossfitWorkouts,
  movements,
} from "@/db/schema";
import {
  parseRepScheme,
  type RepSchemeParsed,
} from "@/lib/crossfit/rep-scheme-parser";
import { computeWorkoutFingerprint } from "@/lib/crossfit/fingerprint";
import { buildFingerprintInput } from "@/lib/crossfit/upsert-template";
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
  // For_load parts carry the rep scheme on each movement, not the part —
  // the caller should populate this alongside movementIds (parallel array)
  // so we can classify "5-5-5-5-5 Back Squat" workouts that wouldn't fit
  // otherwise. Position matters: movementPrescribedReps[i] corresponds to
  // movementIds[i].
  movementPrescribedReps?: Array<string | null | undefined>;
}

/**
 * Determine whether the built workout qualifies for auto-linking to a
 * weightlifting benchmark template. Returns the matched template id + rep
 * target, or null when no rule fires.
 *
 * Qualifying shape (all must hold):
 *   - exactly one part, workoutType = 'for_load'
 *   - exactly one movement on that part, and that movement has
 *     is_1rm_applicable = true
 *   - rep scheme classifies to {1, 2, 3, 5} via inferRepMaxTarget
 *   - a system template exists with weightlifting_movement_id = movement.id
 *
 * A single read confirms both the movement's applicability and the
 * template's existence — callers don't need to pre-fetch movement state.
 */
export async function inferWeightliftingBenchmark(
  tx: TxOrDb,
  parts: InferencePart[]
): Promise<{ templateId: string; repTarget: RepMaxTarget } | null> {
  if (parts.length !== 1) return null;
  const part = parts[0];
  if (part.workoutType !== "for_load") return null;
  if (part.movementIds.length !== 1) return null;

  // Prefer the movement-level rep scheme — For Load workouts surface that
  // input per-movement, not at the part level — and fall back to the
  // part-level scheme for legacy/admin-authored benchmarks.
  const movementScheme = part.movementPrescribedReps?.[0] ?? null;
  const repTarget = inferRepMaxTarget(movementScheme ?? part.repScheme ?? null);
  if (!repTarget) return null;

  const movementId = part.movementIds[0];

  const [match] = await tx
    .select({ templateId: crossfitWorkouts.id })
    .from(crossfitWorkouts)
    .innerJoin(
      movements,
      eq(movements.id, crossfitWorkouts.weightliftingMovementId)
    )
    .where(
      and(
        eq(crossfitWorkouts.weightliftingMovementId, movementId),
        eq(crossfitWorkouts.isSystem, true),
        eq(crossfitWorkouts.isBenchmark, true),
        eq(movements.is1rmApplicable, true)
      )
    )
    .limit(1);

  if (!match) return null;
  return { templateId: match.templateId, repTarget };
}

// ---------------------------------------------------------------------------
// Upsert: ensure a weightlifting benchmark template exists for a movement
// ---------------------------------------------------------------------------

interface MovementSeed {
  id: string;
  canonicalName: string;
}

/**
 * Idempotent upsert. Creates (or refreshes) the single template anchored to
 * `movement.id` plus its single for_load part plus its single movement row.
 *
 * Wrap callers in a transaction so an admin write that flips
 * is_1rm_applicable and the dependent template upsert succeed or fail
 * together.
 */
export async function ensureWeightliftingBenchmark(
  tx: TxOrDb,
  movement: MovementSeed
): Promise<string> {
  // Look up by movement id — a weightlifting benchmark is uniquely anchored
  // to a single movement.
  const [existing] = await tx
    .select({ id: crossfitWorkouts.id })
    .from(crossfitWorkouts)
    .where(
      and(
        eq(crossfitWorkouts.weightliftingMovementId, movement.id),
        eq(crossfitWorkouts.isSystem, true),
        eq(crossfitWorkouts.isBenchmark, true)
      )
    )
    .limit(1);

  // The content fingerprint of a weightlifting benchmark: one for_load part
  // with one movement, no rep scheme, no prescribed weight. Stable across
  // every movement (only the movementId varies).
  const fingerprint = computeWorkoutFingerprint(
    buildFingerprintInput({
      title: movement.canonicalName,
      scope: { kind: "system" },
      workoutType: "for_load",
      isBenchmark: true,
      isSystem: true,
      weightliftingMovementId: movement.id,
      parts: [
        {
          workoutType: "for_load",
          movements: [{ movementId: movement.id }],
        },
      ],
    })
  );

  let templateId: string;

  const description = `Rep-max benchmark for ${movement.canonicalName} — track your 1RM, 2RM, 3RM, and 5RM in one place.`;

  if (existing) {
    templateId = existing.id;
    await tx
      .update(crossfitWorkouts)
      .set({
        title: movement.canonicalName,
        description,
        workoutType: "for_load",
        category: "weightlifting",
        repScheme: null,
        isSystem: true,
        isBenchmark: true,
        weightliftingMovementId: movement.id,
        contentFingerprint: fingerprint,
        updatedAt: new Date(),
      })
      .where(eq(crossfitWorkouts.id, templateId));

    // Rebuild parts + movements idempotently. Cascade removes the
    // crossfit_workout_movements rows attached to the deleted parts.
    await tx
      .delete(crossfitWorkoutParts)
      .where(eq(crossfitWorkoutParts.crossfitWorkoutId, templateId));
  } else {
    const [inserted] = await tx
      .insert(crossfitWorkouts)
      .values({
        title: movement.canonicalName,
        description,
        workoutType: "for_load",
        category: "weightlifting",
        repScheme: null,
        isSystem: true,
        isBenchmark: true,
        weightliftingMovementId: movement.id,
        contentFingerprint: fingerprint,
      })
      .returning({ id: crossfitWorkouts.id });
    templateId = inserted.id;
  }

  const [part] = await tx
    .insert(crossfitWorkoutParts)
    .values({
      crossfitWorkoutId: templateId,
      orderIndex: 0,
      workoutType: "for_load",
    })
    .returning({ id: crossfitWorkoutParts.id });

  await tx.insert(crossfitWorkoutMovements).values({
    crossfitWorkoutId: templateId,
    crossfitWorkoutPartId: part.id,
    movementId: movement.id,
    orderIndex: 0,
  });

  return templateId;
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
// List helper — every weightlifting benchmark template with its anchor movement id
// ---------------------------------------------------------------------------

/**
 * Pulls the (templateId, movementId) pairs for every weightlifting
 * benchmark template. Used by the list/detail endpoints to enrich the
 * response with per-rep-max stats without N+1 queries.
 */
export async function listWeightliftingBenchmarkAnchors(
  tx: TxOrDb
): Promise<Array<{ templateId: string; movementId: string }>> {
  const rows = await tx
    .select({
      templateId: crossfitWorkouts.id,
      movementId: crossfitWorkouts.weightliftingMovementId,
    })
    .from(crossfitWorkouts)
    .where(
      and(
        isNotNull(crossfitWorkouts.weightliftingMovementId),
        eq(crossfitWorkouts.isSystem, true),
        eq(crossfitWorkouts.isBenchmark, true)
      )
    );
  return rows
    .filter((r): r is { templateId: string; movementId: string } => !!r.movementId)
    .map((r) => ({ templateId: r.templateId, movementId: r.movementId }));
}
