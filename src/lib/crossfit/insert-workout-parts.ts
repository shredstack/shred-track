// Shared part-insertion helper.
//
// Used by the programming section content endpoint to write Smart Builder
// output into the parts/blocks/movements tables. Mirrors the inner-loop
// behavior of POST /api/workouts so the Smart Builder produces consistent
// rows whether the workout was created from /crossfit or from /gym/programming.
//
// NOTE: this file deliberately duplicates the helpers from
// src/app/api/workouts/route.ts. A future refactor should consolidate
// both call sites — kept duplicated for now to avoid coupling.

import { workoutBlocks, workoutMovements, workoutParts } from "@/db/schema";
import { parseDurationToSeconds } from "@/lib/crossfit/duration-parser";
import { parseRepScheme, type RepSchemeParsed } from "@/lib/crossfit/rep-scheme-parser";
import type { PartnerWorkMode, WorkoutType } from "@/types/crossfit";

export interface PartMovementInput {
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
  equipmentCount?: number;
  rxStandard?: string;
  notes?: string;
  prescribedDurationSecondsMale?: number | string;
  prescribedDurationSecondsFemale?: number | string;
  prescribedHeightInches?: number | string;
  prescribedHeightInchesMale?: number | string;
  prescribedHeightInchesFemale?: number | string;
  prescribedWeightMaleBwMultiplier?: number | string;
  prescribedWeightFemaleBwMultiplier?: number | string;
  // weight_pct Rx — the percentage and the builder tempId of the earlier
  // for_load part it anchors to (resolved to a real id at insert time).
  prescribedWeightPct?: number | string;
  weightPctSourcePartTempRef?: string | null;
  tempo?: string;
  isMaxReps?: boolean;
  captureDurationPerRound?: boolean;
  isSideCadence?: boolean;
  weightSource?: "prescribed" | "athlete";
  blockId?: string | null;
  blockTempRef?: string | null;
}

export interface PartBlockInput {
  id?: string;
  tempRef?: string;
  title: string;
  orderIndex?: number;
}

export interface PartInput {
  // Builder tempId for this part. Earlier parts' tempRefs are resolved to
  // real ids so later parts' weight_pct movements can anchor to them.
  tempRef?: string;
  label?: string;
  workoutType: WorkoutType;
  timeCapSeconds?: number;
  amrapDurationSeconds?: number;
  emomIntervalSeconds?: number;
  intervalWorkSeconds?: number | string;
  intervalRestSeconds?: number | string;
  intervalRounds?: { workSeconds: number | string; restSeconds: number | string }[];
  sideCadenceIntervalSeconds?: number | string;
  sideCadenceOpenEnded?: boolean;
  repScheme?: string;
  rounds?: number;
  structure?: string;
  scoreType?: "reps" | "load" | null;
  roundScoreAggregation?: "slowest" | "fastest" | "sum" | "average";
  roundWindowSeconds?: number | string;
  partnerWorkMode?: PartnerWorkMode | null;
  restAfterSeconds?: number | string | null;
  suppressTrailingRest?: boolean;
  notes?: string;
  movements: PartMovementInput[];
  blocks?: PartBlockInput[];
}

function toIntOrNull(value: number | string | undefined | null): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function toTextOrNull(value: number | string | undefined | null): string | null {
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
  const n = typeof value === "number" ? value : parseFloat(value);
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

/**
 * Insert a sequence of parts into a workout. When `sectionId` is provided,
 * each new part is tagged with that section, and the part's `orderIndex`
 * starts at `startOrderIndex` (caller computes this so parts in other
 * sections of the same workout aren't disturbed).
 */
export async function insertWorkoutParts(
  tx: Tx,
  opts: {
    workoutId: string;
    parts: PartInput[];
    sectionId?: string | null;
    startOrderIndex?: number;
  }
): Promise<void> {
  const startIdx = opts.startOrderIndex ?? 0;
  // tempRef → real part id. Parts insert in order, so a later part's
  // weight_pct movement always finds its (earlier) source part here.
  const partTempRefToId = new Map<string, string>();
  for (let i = 0; i < opts.parts.length; i++) {
    const p = opts.parts[i];

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

    if (p.workoutType === "timed_rounds" && !p.rounds) {
      throw new Error(
        "Timed Rounds workouts need a number of rounds. Set the rounds field (e.g. 5)."
      );
    }

    const [part] = await tx
      .insert(workoutParts)
      .values({
        workoutId: opts.workoutId,
        workoutSectionId: opts.sectionId ?? null,
        orderIndex: startIdx + i,
        label: p.label || null,
        workoutType: p.workoutType,
        timeCapSeconds: p.timeCapSeconds || null,
        amrapDurationSeconds: p.amrapDurationSeconds || null,
        emomIntervalSeconds: p.emomIntervalSeconds || null,
        intervalWorkSeconds: toDurationSecondsOrNull(p.intervalWorkSeconds),
        intervalRestSeconds: toDurationSecondsOrNull(p.intervalRestSeconds),
        intervalRounds: normalizeIntervalRounds(p.intervalRounds),
        sideCadenceIntervalSeconds: toDurationSecondsOrNull(
          p.sideCadenceIntervalSeconds
        ),
        sideCadenceOpenEnded: !!p.sideCadenceOpenEnded,
        repScheme: p.repScheme || null,
        rounds: toIntOrNull(p.rounds ?? null),
        structure: p.structure || null,
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
        notes: p.notes || null,
      })
      .returning();

    if (p.tempRef) partTempRefToId.set(p.tempRef, part.id);

    const blockTempRefToId = new Map<string, string>();
    if (Array.isArray(p.blocks) && p.blocks.length > 0) {
      const blocksToInsert = p.blocks
        .map((b, k) => ({
          input: b,
          values: {
            workoutPartId: part.id,
            orderIndex: b.orderIndex ?? k,
            title: b.title?.toString().trim() ?? "",
          },
        }))
        .filter((entry) => entry.values.title.length > 0);
      if (blocksToInsert.length > 0) {
        const inserted = await tx
          .insert(workoutBlocks)
          .values(blocksToInsert.map((entry) => entry.values))
          .returning({ id: workoutBlocks.id });
        for (let k = 0; k < inserted.length; k++) {
          const tempRef = blocksToInsert[k].input.tempRef;
          if (tempRef) blockTempRefToId.set(tempRef, inserted[k].id);
        }
      }
    }

    if (p.movements.length > 0) {
      await tx.insert(workoutMovements).values(
        p.movements.map((m, j) => ({
          workoutId: opts.workoutId,
          workoutPartId: part.id,
          workoutBlockId: m.blockTempRef
            ? blockTempRefToId.get(m.blockTempRef) ?? null
            : m.blockId ?? null,
          movementId: m.movementId,
          orderIndex: m.orderIndex ?? j,
          prescribedReps: m.prescribedReps || null,
          prescribedWeightMale: m.prescribedWeightMale?.toString() || null,
          prescribedWeightFemale: m.prescribedWeightFemale?.toString() || null,
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
          repSchemeParsed: parseAndPromote(
            m.prescribedReps,
            m.promoteSequenceToLadder ?? false
          ),
          equipmentCount: m.equipmentCount ?? null,
          rxStandard: m.rxStandard || null,
          notes: m.notes || null,
          weightSource: m.weightSource ?? "prescribed",
        }))
      );
    }
  }
}
