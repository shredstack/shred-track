// ---------------------------------------------------------------------------
// Template upsert.
//
// Computes the content fingerprint of a prescription, looks up an existing
// `crossfit_workouts` row in the same scope, and either returns its id or
// inserts a new one (plus its parts/blocks/movements tree).
//
// Two saves of the same prescription in the same scope dedup to a single
// template, so repeated workouts naturally accumulate trend history. The
// caller is responsible for then creating a `workout_sessions` row that
// points at this template — see `session-writer.ts`.
// ---------------------------------------------------------------------------

import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  crossfitWorkoutBlocks,
  crossfitWorkoutMovements,
  crossfitWorkoutParts,
  crossfitWorkouts,
} from "@/db/schema";
import { parseDurationToSeconds } from "@/lib/crossfit/duration-parser";
import {
  parseRepScheme,
  type RepSchemeParsed,
} from "@/lib/crossfit/rep-scheme-parser";
import { computeWorkoutFingerprint } from "@/lib/crossfit/fingerprint";
import type {
  FingerprintInput,
  FingerprintMovement,
  FingerprintPart,
  FingerprintWorkoutLevel,
} from "@/lib/crossfit/fingerprint";
import type {
  PartnerWorkMode,
  VestRequirement,
  WorkoutType,
} from "@/types/crossfit";

export type TemplatePartMovementInput = {
  movementId: string;
  orderIndex?: number;
  prescribedReps?: string;
  prescribedWeightMale?: number | string;
  prescribedWeightFemale?: number | string;
  prescribedCaloriesMale?: number | string;
  prescribedCaloriesFemale?: number | string;
  prescribedDistanceMale?: number | string;
  prescribedDistanceFemale?: number | string;
  promoteSequenceToLadder?: boolean;
  equipmentCount?: number | null;
  rxStandard?: string | null;
  notes?: string | null;
  prescribedDurationSecondsMale?: number | string;
  prescribedDurationSecondsFemale?: number | string;
  prescribedHeightInches?: number | string;
  prescribedHeightInchesMale?: number | string;
  prescribedHeightInchesFemale?: number | string;
  prescribedWeightMaleBwMultiplier?: number | string;
  prescribedWeightFemaleBwMultiplier?: number | string;
  prescribedWeightPct?: number | string;
  weightPctSourcePartTempRef?: string | null;
  tempo?: string | null;
  isMaxReps?: boolean;
  captureDurationPerRound?: boolean;
  isSideCadence?: boolean;
  slotIndex?: number | null;
  weightSource?: "prescribed" | "athlete";
  blockId?: string | null;
  blockTempRef?: string | null;
};

export type TemplatePartBlockInput = {
  id?: string;
  tempRef?: string;
  title: string;
  orderIndex?: number;
};

export type TemplatePartInput = {
  tempRef?: string;
  label?: string | null;
  workoutType: WorkoutType;
  timeCapSeconds?: number | null;
  amrapDurationSeconds?: number | null;
  emomIntervalSeconds?: number | null;
  intervalWorkSeconds?: number | string | null;
  intervalRestSeconds?: number | string | null;
  intervalRounds?: {
    workSeconds: number | string;
    restSeconds: number | string;
  }[];
  sideCadenceIntervalSeconds?: number | string | null;
  sideCadenceOpenEnded?: boolean;
  repScheme?: string | null;
  rounds?: number | null;
  structure?: string | null;
  scoreType?: "reps" | "load" | null;
  // Timed Rounds — aggregation strategy + optional per-round window
  // (seconds, or mm:ss-style string the server parses).
  roundScoreAggregation?:
    | "slowest"
    | "fastest"
    | "sum"
    | "average"
    | null;
  roundWindowSeconds?: number | string | null;
  // Partner work mode — set on each part of an `isPartner` workout to
  // pick the work-sharing style. Null = no explicit mode (= 'any' on read).
  partnerWorkMode?: PartnerWorkMode | null;
  // Rest period rendered after this part. Accepts mm:ss string or seconds.
  restAfterSeconds?: number | string | null;
  // For `intervals` parts: omit rest after the final round.
  suppressTrailingRest?: boolean;
  notes?: string | null;
  movements: TemplatePartMovementInput[];
  blocks?: TemplatePartBlockInput[];
};

export type UpsertTemplateScope =
  | { kind: "personal"; userId: string }
  | { kind: "community"; communityId: string }
  | { kind: "system" };

export type UpsertTemplateInput = {
  // Identity / cosmetic fields
  title: string;
  description?: string | null;
  category?: string | null;
  isBenchmark?: boolean;
  isSystem?: boolean;
  weightliftingMovementId?: string | null;
  coachNotes?: string | null;
  // Scope
  scope: UpsertTemplateScope;
  // Workout-level prescription fields (mirror the primary part for fast
  // list rendering — usually copied from parts[0]).
  workoutType: WorkoutType;
  timeCapSeconds?: number | null;
  amrapDurationSeconds?: number | null;
  repScheme?: string | null;
  rounds?: number | null;
  vestRequirement?: VestRequirement;
  vestWeightMaleLb?: number | string | null;
  vestWeightFemaleLb?: number | string | null;
  isPartner?: boolean;
  partnerCount?: number | null;
  // Optional pre-set lineage (used by fork-template).
  forkedFromCrossfitWorkoutId?: string | null;
  // The prescription. Order matters.
  parts: TemplatePartInput[];
};

export type UpsertTemplateResult = {
  templateId: string;
  isNew: boolean;
  contentFingerprint: string;
  // Resolved real-id for each part by orderIndex (caller can map tempRef →
  // real id if needed for downstream linkage, though most callers don't).
  partIdsByOrder: string[];
};

// ---------------------------------------------------------------------------
// Internal helpers — mirrors the legacy `insert-workout-parts.ts` coercion
// rules so a payload that worked there continues to work here. Kept inline
// rather than re-imported so this file owns its own coercion contract.
// ---------------------------------------------------------------------------

function toIntOrNull(value: number | string | undefined | null): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : parseInt(value as string, 10);
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

function toDurationSecondsOrNull(
  value: number | string | undefined | null
): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  }
  return parseDurationToSeconds(value);
}

function normalizeIntervalRounds(
  rounds:
    | { workSeconds: number | string; restSeconds: number | string }[]
    | null
    | undefined
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

function toNumericOrNull(
  value: number | string | undefined | null
): string | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(value as string);
  if (!Number.isFinite(n) || n < 0) return null;
  return String(n);
}

function parseAndPromote(
  reps: string | null | undefined,
  promote: boolean
): RepSchemeParsed | null {
  const parsed = parseRepScheme(reps ?? null);
  if (!parsed || !promote || parsed.kind !== "sequence") return parsed;
  if (parsed.reps.length >= 3) {
    const step = parsed.reps[1] - parsed.reps[0];
    if (step <= 0) return parsed;
    let ok = true;
    for (let i = 2; i < parsed.reps.length; i++) {
      if (parsed.reps[i] - parsed.reps[i - 1] !== step) {
        ok = false;
        break;
      }
    }
    if (ok) {
      return { kind: "ladder", start: parsed.reps[0], step, openEnded: true };
    }
  }
  return parsed;
}

// Build the fingerprint input from the upsert payload.
export function buildFingerprintInput(
  input: UpsertTemplateInput
): FingerprintInput {
  const workout: FingerprintWorkoutLevel = {
    workoutType: input.workoutType,
    timeCapSeconds: input.timeCapSeconds ?? null,
    amrapDurationSeconds: input.amrapDurationSeconds ?? null,
    repScheme: input.repScheme ?? null,
    rounds: input.rounds ?? null,
    vestRequirement: input.vestRequirement ?? "none",
    vestWeightMaleLb: input.vestWeightMaleLb ?? null,
    vestWeightFemaleLb: input.vestWeightFemaleLb ?? null,
    isPartner: input.isPartner ?? false,
    partnerCount: input.partnerCount ?? null,
    weightliftingMovementId: input.weightliftingMovementId ?? null,
  };
  const parts: FingerprintPart[] = input.parts.map((p, i) => {
    // Pre-compute the block tempRef → orderIndex map so we can attach
    // blockOrderIndex to each movement.
    const blockOrderByTempRef = new Map<string, number>();
    const blocks = p.blocks ?? [];
    blocks.forEach((b, k) => {
      const order = b.orderIndex ?? k;
      if (b.tempRef) blockOrderByTempRef.set(b.tempRef, order);
    });
    const movements: FingerprintMovement[] = p.movements.map((m, j) => {
      let blockOrderIndex: number | null = null;
      if (m.blockTempRef && blockOrderByTempRef.has(m.blockTempRef)) {
        blockOrderIndex = blockOrderByTempRef.get(m.blockTempRef)!;
      }
      return {
        movementId: m.movementId,
        orderIndex: m.orderIndex ?? j,
        blockOrderIndex,
        prescribedReps: m.prescribedReps ?? null,
        prescribedWeightMale: m.prescribedWeightMale ?? null,
        prescribedWeightFemale: m.prescribedWeightFemale ?? null,
        prescribedCaloriesMale:
          m.prescribedCaloriesMale != null
            ? String(m.prescribedCaloriesMale)
            : null,
        prescribedCaloriesFemale:
          m.prescribedCaloriesFemale != null
            ? String(m.prescribedCaloriesFemale)
            : null,
        prescribedDistanceMale:
          m.prescribedDistanceMale != null
            ? String(m.prescribedDistanceMale)
            : null,
        prescribedDistanceFemale:
          m.prescribedDistanceFemale != null
            ? String(m.prescribedDistanceFemale)
            : null,
        prescribedDurationSecondsMale:
          toDurationSecondsOrNull(m.prescribedDurationSecondsMale ?? null),
        prescribedDurationSecondsFemale:
          toDurationSecondsOrNull(m.prescribedDurationSecondsFemale ?? null),
        prescribedHeightInches: m.prescribedHeightInches ?? null,
        prescribedHeightInchesMale: m.prescribedHeightInchesMale ?? null,
        prescribedHeightInchesFemale: m.prescribedHeightInchesFemale ?? null,
        prescribedWeightMaleBwMultiplier:
          m.prescribedWeightMaleBwMultiplier ?? null,
        prescribedWeightFemaleBwMultiplier:
          m.prescribedWeightFemaleBwMultiplier ?? null,
        prescribedWeightPct: m.prescribedWeightPct ?? null,
        tempo: m.tempo ?? null,
        isMaxReps: !!m.isMaxReps,
        captureDurationPerRound: !!m.captureDurationPerRound,
        isSideCadence: !!m.isSideCadence,
        slotIndex: m.slotIndex ?? null,
        equipmentCount: m.equipmentCount ?? null,
        rxStandard: m.rxStandard ?? null,
        // Conditional-emit inside fingerprint.ts means 'prescribed' / null
        // values DO NOT alter the legacy hash. Forwarded raw here.
        weightSource: m.weightSource ?? null,
      };
    });
    return {
      orderIndex: i,
      workoutType: p.workoutType,
      timeCapSeconds: p.timeCapSeconds ?? null,
      amrapDurationSeconds: p.amrapDurationSeconds ?? null,
      emomIntervalSeconds: p.emomIntervalSeconds ?? null,
      repScheme: p.repScheme ?? null,
      rounds: p.rounds ?? null,
      structure: p.structure ?? null,
      intervalWorkSeconds: toDurationSecondsOrNull(p.intervalWorkSeconds),
      intervalRestSeconds: toDurationSecondsOrNull(p.intervalRestSeconds),
      intervalRounds: normalizeIntervalRounds(p.intervalRounds),
      sideCadenceIntervalSeconds: toDurationSecondsOrNull(
        p.sideCadenceIntervalSeconds
      ),
      sideCadenceOpenEnded: !!p.sideCadenceOpenEnded,
      scoreType: p.scoreType ?? null,
      roundScoreAggregation:
        p.workoutType === "timed_rounds"
          ? p.roundScoreAggregation ?? "slowest"
          : null,
      roundWindowSeconds:
        p.workoutType === "timed_rounds"
          ? toDurationSecondsOrNull(p.roundWindowSeconds ?? null)
          : null,
      partnerWorkMode: p.partnerWorkMode ?? null,
      restAfterSeconds: toDurationSecondsOrNull(p.restAfterSeconds ?? null),
      suppressTrailingRest:
        p.workoutType === "intervals" ? !!p.suppressTrailingRest : false,
      movements,
    };
  });
  return { workout, parts };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

export async function upsertTemplate(
  tx: Tx,
  input: UpsertTemplateInput
): Promise<UpsertTemplateResult> {
  const fingerprint = computeWorkoutFingerprint(buildFingerprintInput(input));
  const isBenchmark = !!input.isBenchmark;
  const isSystem = !!input.isSystem;

  // Look up an existing template in the same scope. System templates are
  // not deduped — their seed already guarantees uniqueness.
  const existingId = isSystem
    ? null
    : await findExistingTemplate(tx, {
        scope: input.scope,
        fingerprint,
        isBenchmark,
      });

  if (existingId) {
    const partIds = await loadPartIdsByOrder(tx, existingId);
    return {
      templateId: existingId,
      isNew: false,
      contentFingerprint: fingerprint,
      partIdsByOrder: partIds,
    };
  }

  const [template] = await tx
    .insert(crossfitWorkouts)
    .values({
      title: input.title,
      description: input.description ?? null,
      category: input.category ?? null,
      isBenchmark,
      isSystem,
      weightliftingMovementId: input.weightliftingMovementId ?? null,
      createdBy: input.scope.kind === "personal" ? input.scope.userId : null,
      communityId:
        input.scope.kind === "community" ? input.scope.communityId : null,
      contentFingerprint: fingerprint,
      forkedFromCrossfitWorkoutId: input.forkedFromCrossfitWorkoutId ?? null,
      workoutType: input.workoutType,
      timeCapSeconds: input.timeCapSeconds ?? null,
      amrapDurationSeconds: input.amrapDurationSeconds ?? null,
      repScheme: input.repScheme ?? null,
      rounds: input.rounds ?? null,
      vestRequirement: input.vestRequirement ?? "none",
      vestWeightMaleLb:
        input.vestWeightMaleLb != null ? String(input.vestWeightMaleLb) : null,
      vestWeightFemaleLb:
        input.vestWeightFemaleLb != null
          ? String(input.vestWeightFemaleLb)
          : null,
      isPartner: !!input.isPartner,
      partnerCount: input.partnerCount ?? null,
      coachNotes: input.coachNotes ?? null,
    })
    .returning({ id: crossfitWorkouts.id });

  const partIdsByOrder = await insertTemplateParts(tx, template.id, input.parts);
  return {
    templateId: template.id,
    isNew: true,
    contentFingerprint: fingerprint,
    partIdsByOrder,
  };
}

async function findExistingTemplate(
  tx: Tx,
  opts: {
    scope: UpsertTemplateScope;
    fingerprint: string;
    isBenchmark: boolean;
  }
): Promise<string | null> {
  if (opts.scope.kind === "personal") {
    const row = await tx
      .select({ id: crossfitWorkouts.id })
      .from(crossfitWorkouts)
      .where(
        and(
          eq(crossfitWorkouts.createdBy, opts.scope.userId),
          eq(crossfitWorkouts.contentFingerprint, opts.fingerprint),
          eq(crossfitWorkouts.isBenchmark, opts.isBenchmark)
        )
      )
      .limit(1);
    return row[0]?.id ?? null;
  }
  if (opts.scope.kind === "community") {
    const row = await tx
      .select({ id: crossfitWorkouts.id })
      .from(crossfitWorkouts)
      .where(
        and(
          eq(crossfitWorkouts.communityId, opts.scope.communityId),
          eq(crossfitWorkouts.contentFingerprint, opts.fingerprint),
          eq(crossfitWorkouts.isBenchmark, opts.isBenchmark)
        )
      )
      .limit(1);
    return row[0]?.id ?? null;
  }
  return null;
}

async function loadPartIdsByOrder(
  tx: Tx,
  templateId: string
): Promise<string[]> {
  const rows = await tx
    .select({
      id: crossfitWorkoutParts.id,
      orderIndex: crossfitWorkoutParts.orderIndex,
    })
    .from(crossfitWorkoutParts)
    .where(eq(crossfitWorkoutParts.crossfitWorkoutId, templateId))
    .orderBy(crossfitWorkoutParts.orderIndex);
  return rows.map((r: { id: string }) => r.id);
}

// Insert all parts + blocks + movements for a template. Returns the new
// part ids in order so callers can map (orderIndex → id) if needed.
export async function insertTemplateParts(
  tx: Tx,
  templateId: string,
  parts: TemplatePartInput[]
): Promise<string[]> {
  const partTempRefToId = new Map<string, string>();
  const partIdsByOrder: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];

    if (p.workoutType === "intervals") {
      const normalizedRounds = normalizeIntervalRounds(p.intervalRounds);
      if (!normalizedRounds) {
        const work = toDurationSecondsOrNull(p.intervalWorkSeconds);
        const rest = toDurationSecondsOrNull(p.intervalRestSeconds);
        if (!p.rounds) {
          throw new Error(
            "Intervals workouts need a number of rounds. Set the rounds field (e.g. 3)."
          );
        }
        if (work == null && rest == null) {
          throw new Error(
            "Intervals workouts need a work or rest duration per round. Add at least one (e.g. 2:00 rest)."
          );
        }
      }
    }

    if (p.workoutType === "timed_rounds") {
      if (!p.rounds || toIntOrNull(p.rounds) == null) {
        throw new Error(
          "Timed Rounds workouts need a number of rounds. Set the rounds field (e.g. 5)."
        );
      }
    }

    const [part] = await tx
      .insert(crossfitWorkoutParts)
      .values({
        crossfitWorkoutId: templateId,
        orderIndex: i,
        label: p.label || null,
        workoutType: p.workoutType,
        timeCapSeconds: p.timeCapSeconds ?? null,
        amrapDurationSeconds: p.amrapDurationSeconds ?? null,
        emomIntervalSeconds: p.emomIntervalSeconds ?? null,
        intervalWorkSeconds: toDurationSecondsOrNull(p.intervalWorkSeconds),
        intervalRestSeconds: toDurationSecondsOrNull(p.intervalRestSeconds),
        intervalRounds: normalizeIntervalRounds(p.intervalRounds),
        sideCadenceIntervalSeconds: toDurationSecondsOrNull(
          p.sideCadenceIntervalSeconds
        ),
        sideCadenceOpenEnded: !!p.sideCadenceOpenEnded,
        repScheme: p.repScheme ?? null,
        rounds: toIntOrNull(p.rounds ?? null),
        structure: p.structure ?? null,
        scoreType: p.scoreType ?? null,
        roundScoreAggregation:
          p.workoutType === "timed_rounds"
            ? p.roundScoreAggregation ?? "slowest"
            : null,
        roundWindowSeconds:
          p.workoutType === "timed_rounds"
            ? toDurationSecondsOrNull(p.roundWindowSeconds ?? null)
            : null,
        partnerWorkMode: p.partnerWorkMode ?? null,
        restAfterSeconds: toDurationSecondsOrNull(p.restAfterSeconds ?? null),
        suppressTrailingRest:
          p.workoutType === "intervals" ? !!p.suppressTrailingRest : false,
        notes: p.notes ?? null,
      })
      .returning({ id: crossfitWorkoutParts.id });

    partIdsByOrder.push(part.id);
    if (p.tempRef) partTempRefToId.set(p.tempRef, part.id);

    const blockTempRefToId = new Map<string, string>();
    if (Array.isArray(p.blocks) && p.blocks.length > 0) {
      const blocksToInsert = p.blocks
        .map((b, k) => ({
          input: b,
          values: {
            crossfitWorkoutPartId: part.id,
            orderIndex: b.orderIndex ?? k,
            title: b.title?.toString().trim() ?? "",
          },
        }))
        .filter((entry) => entry.values.title.length > 0);
      if (blocksToInsert.length > 0) {
        const inserted = await tx
          .insert(crossfitWorkoutBlocks)
          .values(blocksToInsert.map((entry) => entry.values))
          .returning({ id: crossfitWorkoutBlocks.id });
        for (let k = 0; k < inserted.length; k++) {
          const tempRef = blocksToInsert[k].input.tempRef;
          if (tempRef) blockTempRefToId.set(tempRef, inserted[k].id);
        }
      }
    }

    if (p.movements.length > 0) {
      await tx.insert(crossfitWorkoutMovements).values(
        p.movements.map((m, j) => ({
          crossfitWorkoutId: templateId,
          crossfitWorkoutPartId: part.id,
          crossfitWorkoutBlockId: m.blockTempRef
            ? blockTempRefToId.get(m.blockTempRef) ?? null
            : m.blockId ?? null,
          movementId: m.movementId,
          orderIndex: m.orderIndex ?? j,
          prescribedReps: m.prescribedReps || null,
          prescribedWeightMale:
            m.prescribedWeightMale != null
              ? String(m.prescribedWeightMale)
              : null,
          prescribedWeightFemale:
            m.prescribedWeightFemale != null
              ? String(m.prescribedWeightFemale)
              : null,
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
          prescribedHeightInchesMale: toNumericOrNull(
            m.prescribedHeightInchesMale
          ),
          prescribedHeightInchesFemale: toNumericOrNull(
            m.prescribedHeightInchesFemale
          ),
          prescribedWeightMaleBwMultiplier: toNumericOrNull(
            m.prescribedWeightMaleBwMultiplier
          ),
          prescribedWeightFemaleBwMultiplier: toNumericOrNull(
            m.prescribedWeightFemaleBwMultiplier
          ),
          prescribedWeightPct: toNumericOrNull(m.prescribedWeightPct),
          prescribedWeightPctSourcePartId: m.weightPctSourcePartTempRef
            ? partTempRefToId.get(m.weightPctSourcePartTempRef) ?? null
            : null,
          tempo: m.tempo?.trim() || null,
          isMaxReps: !!m.isMaxReps,
          captureDurationPerRound: !!m.captureDurationPerRound,
          isSideCadence: !!m.isSideCadence,
          slotIndex: m.slotIndex ?? null,
          repSchemeParsed: parseAndPromote(
            m.prescribedReps,
            m.promoteSequenceToLadder ?? false
          ),
          equipmentCount: m.equipmentCount ?? null,
          rxStandard: m.rxStandard || null,
          notes: m.notes ?? null,
          weightSource: m.weightSource ?? "prescribed",
        }))
      );
    }
  }

  return partIdsByOrder;
}

// Convenience: bump a template's `updated_at` (callers may want to do this
// when a session referencing the template is touched).
export async function touchTemplate(tx: Tx, templateId: string): Promise<void> {
  await tx
    .update(crossfitWorkouts)
    .set({ updatedAt: sql`now()` })
    .where(eq(crossfitWorkouts.id, templateId));
}
