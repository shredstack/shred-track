// ---------------------------------------------------------------------------
// Suggested-weight engine.
//
// Produces a per-(athlete, movement-on-this-part) working-weight suggestion
// with a confidence tier. Cascade (highest-confidence first):
//   1. Direct same-template history (athlete's last actual weight on this
//      exact template).
//   2. Logged 1RM × stimulus-band.
//   3. Estimated 1RM × stimulus-band.
//   3.5. Movement history across templates (athlete's prior log of the same
//        movement on a different template, scaled to today's prescribed
//        weight by the prior scaling ratio). Catches dumbbell / kettlebell /
//        sandbag movements that don't have a 1RM and would otherwise fall
//        through to the Rx fallback. See notes_insights_v2_spec.md §4.
//   4. Similar-stimulus history (averaged actual weights from other
//      templates of the same stimulus class).
//   5. Rx fallback (gender-appropriate prescribed weight × 0.85–1.0).
//
// Returns 'unavailable' when no signal exists.
//
// See claude_code_instructions/crossfit_improvements/
//     suggested_working_weight_and_template_history_spec.md §"Algorithm —
//     per-movement suggestion cascade".
// ---------------------------------------------------------------------------

import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  athleteMovementStrength,
  crossfitWorkoutMovements,
  crossfitWorkoutParts,
  crossfitWorkouts,
  movements,
  scoreMovementDetails,
  scores,
  stimulusProfiles,
  workoutSessions,
  type StimulusClass,
  type SuggestedWeightMethod,
} from "@/db/schema";
import {
  classifyStimulus,
  type PartForClassification,
} from "./stimulus";

export type SuggestedWeightConfidence = "high" | "medium" | "low";

/**
 * Carried on `movement_history` suggestions so the chip's "Why?" sheet and
 * the workout-detail prep card can render the prior log alongside today's
 * prescribed weight. The athlete needs to see "Apr 22: prescribed 50 lb,
 * you used 35 lb" to read the suggestion as anything more than a number.
 */
export interface PriorMovementContext {
  workoutDate: string; // YYYY-MM-DD
  priorPrescribedLb: number | null;
  priorActualLb: number;
  rpe: number | null;
  workoutTemplateTitle: string | null;
}

export interface SuggestedWeight {
  method: SuggestedWeightMethod;
  confidence: SuggestedWeightConfidence;
  lowLb: number;
  highLb: number;
  /** 1RM (or estimate) used as the anchor when method ∈ {logged_1rm,
   *  estimated_1rm}. */
  anchor1rmLb?: number | null;
  /** Short human-readable source label for the "Why?" sheet. */
  anchorSource?: string | null;
  stimulusClass: StimulusClass | null;
  /** Populated by the `movement_history` tier so the UI can render the
   *  prior log side-by-side with today's prescribed weight. */
  priorContext?: PriorMovementContext | null;
}

export interface MovementSuggestionInput {
  movementId: string;
  movementCategory: string;
  is1rmApplicable: boolean;
  isWeighted: boolean;
  rxStimulusClass: StimulusClass | null;
  commonRxWeightMale: number | null;
  commonRxWeightFemale: number | null;
  /** crossfit_workout_movements.id — needed for same-template history. */
  crossfitWorkoutMovementId: string;
  /** template id (crossfit_workouts.id) the movement belongs to. */
  crossfitWorkoutId: string;
  /** Today's prescribed loads (used by the movement_history tier to scale
   *  the prior log's effort to today's prescription). */
  prescribedWeightMale: number | null;
  prescribedWeightFemale: number | null;
}

export interface PartSuggestionInput extends PartForClassification {
  movements: MovementSuggestionInput[];
}

interface CtxUser {
  id: string;
  gender: string | null;
}

const DIRECT_HISTORY_LOOKBACK_DAYS = 6 * 30;
const DIRECT_HISTORY_FRESH_DAYS = 90;
const SIMILAR_HISTORY_LOOKBACK_DAYS = 12 * 30;
// Movement-history tier (notes_insights_v2_spec.md §4): same 6-month
// window as direct-history; freshness cliff at 90 days.
const MOVEMENT_HISTORY_LOOKBACK_DAYS = 6 * 30;
const MOVEMENT_HISTORY_FRESH_DAYS = 90;

/**
 * Look up the %1RM band for (stimulusClass, movementCategory). Falls back
 * across categories if there's no exact match. Falls back to 'barbell' as
 * the universal default. Returns null when the table has no row at all.
 */
async function getStimulusBand(
  stimulusClass: StimulusClass,
  movementCategory: string
): Promise<{ low: number; high: number } | null> {
  const candidateCategories = uniqueOrdered([
    movementCategory,
    "barbell", // sensible universal fallback so unmapped categories still get a band
  ]);

  const rows = await db
    .select()
    .from(stimulusProfiles)
    .where(
      and(
        eq(stimulusProfiles.stimulusClass, stimulusClass),
        inArray(stimulusProfiles.movementCategory, candidateCategories)
      )
    );

  if (rows.length === 0) return null;

  for (const cat of candidateCategories) {
    const hit = rows.find((r) => r.movementCategory === cat);
    if (hit) {
      return {
        low: Number(hit.pct1rmLow),
        high: Number(hit.pct1rmHigh),
      };
    }
  }
  return null;
}

function uniqueOrdered<T>(items: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const x of items) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

/**
 * Round a working weight to a plate increment the athlete can actually
 * assemble:
 *   ≥ 75 lb → nearest 5 lb
 *   < 75 lb → nearest 2.5 lb
 */
export function roundToPlate(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 75) return Math.round(value / 5) * 5;
  return Math.round(value / 2.5) * 2.5;
}

function pickRxWeight(
  m: MovementSuggestionInput,
  gender: string | null
): number | null {
  // Default to male Rx unless we know the athlete prefers female-Rx.
  const female =
    m.commonRxWeightFemale != null ? Number(m.commonRxWeightFemale) : null;
  const male =
    m.commonRxWeightMale != null ? Number(m.commonRxWeightMale) : null;
  if (gender === "female") return female ?? male ?? null;
  return male ?? female ?? null;
}

interface DirectHistoryRow {
  scoreId: string;
  workoutDate: string;
  actualWeight: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setEntries: any[] | null;
  rpe: number | null;
}

async function findDirectHistory(
  userId: string,
  m: MovementSuggestionInput
): Promise<DirectHistoryRow[]> {
  const cutoff = daysAgo(DIRECT_HISTORY_LOOKBACK_DAYS);
  const rows = await db
    .select({
      scoreId: scores.id,
      workoutDate: workoutSessions.workoutDate,
      actualWeight: scoreMovementDetails.actualWeight,
      setEntries: scoreMovementDetails.setEntries,
      rpe: scores.rpe,
    })
    .from(scoreMovementDetails)
    .innerJoin(scores, eq(scores.id, scoreMovementDetails.scoreId))
    .innerJoin(
      crossfitWorkoutMovements,
      eq(
        crossfitWorkoutMovements.id,
        scoreMovementDetails.crossfitWorkoutMovementId
      )
    )
    .innerJoin(
      workoutSessions,
      eq(workoutSessions.id, scores.workoutSessionId)
    )
    .where(
      and(
        eq(scores.userId, userId),
        eq(crossfitWorkoutMovements.movementId, m.movementId),
        eq(workoutSessions.crossfitWorkoutId, m.crossfitWorkoutId),
        sql`${workoutSessions.workoutDate} >= ${cutoff.toISOString().slice(0, 10)}`
      )
    )
    .orderBy(desc(workoutSessions.workoutDate))
    .limit(5);
  return rows.map((r) => ({
    scoreId: r.scoreId,
    workoutDate: r.workoutDate,
    actualWeight: r.actualWeight != null ? Number(r.actualWeight) : null,
    setEntries: r.setEntries,
    rpe: r.rpe != null ? Number(r.rpe) : null,
  }));
}

function representativeWeightFromHistory(row: DirectHistoryRow): number | null {
  if (row.setEntries && Array.isArray(row.setEntries) && row.setEntries.length > 0) {
    // Use the heaviest entry as the centerline — that's what they
    // worked up to.
    const max = row.setEntries.reduce((acc: number, e: { weight?: number }) => {
      const w = Number(e?.weight);
      return Number.isFinite(w) && w > acc ? w : acc;
    }, 0);
    if (max > 0) return max;
  }
  if (row.actualWeight != null && row.actualWeight > 0) return row.actualWeight;
  return null;
}

function suggestFromDirectHistory(
  history: DirectHistoryRow[],
  stimulusClass: StimulusClass | null
): SuggestedWeight | null {
  // Most recent qualifying history wins; the spec deliberately doesn't
  // average across attempts (recent capacity is the strongest signal).
  for (const row of history) {
    const w = representativeWeightFromHistory(row);
    if (w == null) continue;

    // RPE nudge: heavy last time → drop 5%; easy last time → bump 5%.
    let centerline = w;
    if (row.rpe != null) {
      if (row.rpe >= 9) centerline = w * 0.95;
      else if (row.rpe <= 6) centerline = w * 1.05;
    }

    const lowLb = roundToPlate(centerline * 0.95);
    const highLb = roundToPlate(centerline * 1.05);
    const daysOld = daysBetween(row.workoutDate, new Date());
    const fresh = daysOld <= DIRECT_HISTORY_FRESH_DAYS;
    const confidence: SuggestedWeightConfidence =
      fresh && row.rpe != null ? "high" : "medium";
    return {
      method: "direct_template_history",
      confidence,
      lowLb,
      highLb,
      anchor1rmLb: null,
      anchorSource: `Last time on this template — ${row.workoutDate}${row.rpe != null ? ` @ RPE ${row.rpe}` : ""}`,
      stimulusClass,
    };
  }
  return null;
}

function suggestFromOneRm(
  estimated1rmLb: number,
  source: string,
  band: { low: number; high: number },
  stimulusClass: StimulusClass,
  baseConfidence: SuggestedWeightConfidence,
  describe: string
): SuggestedWeight {
  return {
    method: source === "logged_1rm" ? "logged_1rm" : "estimated_1rm",
    confidence: baseConfidence,
    lowLb: roundToPlate(estimated1rmLb * band.low),
    highLb: roundToPlate(estimated1rmLb * band.high),
    anchor1rmLb: Math.round(estimated1rmLb * 10) / 10,
    anchorSource: describe,
    stimulusClass,
  };
}

// ============================================
// Movement-history tier (notes_insights_v2_spec.md §4)
// ============================================
//
// Finds the athlete's most recent log of this movement on any *other*
// template in the last 6 months. Tier 1 already covers same-template
// history, so we exclude the current template id. Sorted newest-first;
// the caller takes the most-recent row only.

export interface MovementHistoryRow {
  scoreId: string;
  workoutDate: string;
  actualWeight: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setEntries: any[] | null;
  rpe: number | null;
  priorPrescribedMale: number | null;
  priorPrescribedFemale: number | null;
  workoutTemplateTitle: string | null;
  crossfitWorkoutId: string;
}

async function findMovementHistoryAnyTemplate(
  userId: string,
  movementId: string,
  excludeWorkoutId: string
): Promise<MovementHistoryRow[]> {
  const cutoff = daysAgo(MOVEMENT_HISTORY_LOOKBACK_DAYS);
  const rows = await db
    .select({
      scoreId: scores.id,
      workoutDate: workoutSessions.workoutDate,
      actualWeight: scoreMovementDetails.actualWeight,
      setEntries: scoreMovementDetails.setEntries,
      rpe: scores.rpe,
      priorPrescribedMale: crossfitWorkoutMovements.prescribedWeightMale,
      priorPrescribedFemale: crossfitWorkoutMovements.prescribedWeightFemale,
      workoutTemplateTitle: crossfitWorkouts.title,
      crossfitWorkoutId: crossfitWorkoutMovements.crossfitWorkoutId,
    })
    .from(scoreMovementDetails)
    .innerJoin(scores, eq(scores.id, scoreMovementDetails.scoreId))
    .innerJoin(
      crossfitWorkoutMovements,
      eq(
        crossfitWorkoutMovements.id,
        scoreMovementDetails.crossfitWorkoutMovementId
      )
    )
    .innerJoin(
      crossfitWorkouts,
      eq(crossfitWorkouts.id, crossfitWorkoutMovements.crossfitWorkoutId)
    )
    .innerJoin(
      workoutSessions,
      eq(workoutSessions.id, scores.workoutSessionId)
    )
    .where(
      and(
        eq(scores.userId, userId),
        eq(crossfitWorkoutMovements.movementId, movementId),
        // Exclude the current template — tier 1's responsibility.
        ne(crossfitWorkoutMovements.crossfitWorkoutId, excludeWorkoutId),
        sql`${workoutSessions.workoutDate} >= ${cutoff.toISOString().slice(0, 10)}`
      )
    )
    .orderBy(desc(workoutSessions.workoutDate))
    .limit(10);
  return rows.map((r) => ({
    scoreId: r.scoreId,
    workoutDate: r.workoutDate,
    actualWeight: r.actualWeight != null ? Number(r.actualWeight) : null,
    setEntries: r.setEntries,
    rpe: r.rpe != null ? Number(r.rpe) : null,
    priorPrescribedMale:
      r.priorPrescribedMale != null ? Number(r.priorPrescribedMale) : null,
    priorPrescribedFemale:
      r.priorPrescribedFemale != null ? Number(r.priorPrescribedFemale) : null,
    workoutTemplateTitle: r.workoutTemplateTitle,
    crossfitWorkoutId: r.crossfitWorkoutId,
  }));
}

/**
 * Pick the prior prescribed weight for the gender we suggest against.
 * Mirrors `pickRxWeight` semantics — female-first when gender == 'female',
 * with the opposite-gender column as a fallback so older templates that
 * only seeded one side still resolve.
 */
function pickPriorPrescribed(
  row: { priorPrescribedMale: number | null; priorPrescribedFemale: number | null },
  gender: string | null
): number | null {
  if (gender === "female") {
    return row.priorPrescribedFemale ?? row.priorPrescribedMale ?? null;
  }
  return row.priorPrescribedMale ?? row.priorPrescribedFemale ?? null;
}

function pickTodaysPrescribed(
  m: MovementSuggestionInput,
  gender: string | null
): number | null {
  if (gender === "female") {
    return m.prescribedWeightFemale ?? m.prescribedWeightMale ?? null;
  }
  return m.prescribedWeightMale ?? m.prescribedWeightFemale ?? null;
}

/**
 * Pure math for the movement-history suggestion. Exported for unit tests so
 * the scaling-ratio + RPE-nudge + clamp logic stays DB-independent.
 *
 * Cascade contract:
 *  - When `priorPrescribedLb` is present, the centerline scales today's
 *    prescribed weight by the prior actual/prescribed ratio. This preserves
 *    relative effort — Rx → Rx, 75/105 → ≈71% of today's prescription.
 *  - When `priorPrescribedLb` is null, fall back to the raw prior actual
 *    weight (athlete's most recent observed capacity) and signal `low`
 *    confidence so the chip stays advisory.
 *  - Upper bound clamps to today's prescribed weight; the 1RM tiers own the
 *    heavier-than-Rx case.
 */
export function computeMovementHistorySuggestion(input: {
  priorActualLb: number;
  priorPrescribedLb: number | null;
  todayPrescribedLb: number | null;
  rpe: number | null;
  ageDays: number;
}): {
  centerline: number;
  lowLb: number;
  highLb: number;
  confidence: SuggestedWeightConfidence;
} | null {
  const { priorActualLb, priorPrescribedLb, todayPrescribedLb, rpe, ageDays } =
    input;
  if (!Number.isFinite(priorActualLb) || priorActualLb <= 0) return null;

  let confidence: SuggestedWeightConfidence = "medium";
  // Stale prior → drop to low. Same threshold as DIRECT_HISTORY_FRESH_DAYS.
  if (ageDays > MOVEMENT_HISTORY_FRESH_DAYS) confidence = "low";

  // Default to raw prior actual when we can't compute a scaling ratio.
  let centerline = priorActualLb;
  if (
    priorPrescribedLb != null &&
    priorPrescribedLb > 0 &&
    todayPrescribedLb != null &&
    todayPrescribedLb > 0
  ) {
    const scalingRatio = priorActualLb / priorPrescribedLb;
    centerline = todayPrescribedLb * scalingRatio;
  } else {
    // Missing prescribed weight on the prior log — confidence must drop.
    confidence = "low";
  }

  // RPE nudge: heavy last time → drop 5%; easy last time → bump 5%.
  if (rpe != null) {
    if (rpe >= 9) centerline = centerline * 0.95;
    else if (rpe <= 6) centerline = centerline * 1.05;
  }

  let lowLb = centerline * 0.95;
  let highLb = centerline * 1.05;

  // Clamp the upper bound at today's prescribed weight — the heavier-than-Rx
  // case is the 1RM tiers' job. When today's prescribed weight is missing,
  // we don't clamp (raw-prior-actual mode).
  if (todayPrescribedLb != null && todayPrescribedLb > 0) {
    if (highLb > todayPrescribedLb) highLb = todayPrescribedLb;
    // After clamping high, low might exceed high — pull both to today's
    // prescribed weight in that degenerate case.
    if (lowLb > highLb) lowLb = highLb;
  }

  const roundedLow = roundToPlate(lowLb);
  const roundedHigh = roundToPlate(highLb);
  if (roundedLow <= 0 && roundedHigh <= 0) return null;
  return {
    centerline,
    lowLb: roundedLow,
    highLb: roundedHigh,
    confidence,
  };
}

function suggestFromMovementHistory(
  row: MovementHistoryRow,
  todayPrescribedLb: number | null,
  priorPrescribedLb: number | null,
  stimulusClass: StimulusClass | null
): SuggestedWeight | null {
  const priorActual = representativeWeightFromHistory({
    scoreId: row.scoreId,
    workoutDate: row.workoutDate,
    actualWeight: row.actualWeight,
    setEntries: row.setEntries,
    rpe: row.rpe,
  });
  if (priorActual == null) return null;

  const ageDays = daysBetween(row.workoutDate, new Date());
  const computed = computeMovementHistorySuggestion({
    priorActualLb: priorActual,
    priorPrescribedLb,
    todayPrescribedLb,
    rpe: row.rpe,
    ageDays,
  });
  if (!computed) return null;

  return {
    method: "movement_history",
    confidence: computed.confidence,
    lowLb: computed.lowLb,
    highLb: computed.highLb,
    anchor1rmLb: null,
    anchorSource: `Last time on ${row.workoutTemplateTitle ?? "another template"} — ${row.workoutDate}${row.rpe != null ? ` @ RPE ${row.rpe}` : ""}`,
    stimulusClass,
    priorContext: {
      workoutDate: row.workoutDate,
      priorPrescribedLb,
      priorActualLb: priorActual,
      rpe: row.rpe,
      workoutTemplateTitle: row.workoutTemplateTitle,
    },
  };
}

async function findSimilarStimulusHistory(
  userId: string,
  movementId: string,
  stimulusClass: StimulusClass
): Promise<number[]> {
  const cutoff = daysAgo(SIMILAR_HISTORY_LOOKBACK_DAYS);
  // We don't store the stimulus class on parts; instead we recompute on the
  // fly. This stays a single SQL pass to fetch candidates, then we filter
  // in TS. Bounds the result set to recent scores.
  const rows = await db
    .select({
      partWorkoutType: crossfitWorkoutParts.workoutType,
      timeCapSeconds: crossfitWorkoutParts.timeCapSeconds,
      amrapDurationSeconds: crossfitWorkoutParts.amrapDurationSeconds,
      emomIntervalSeconds: crossfitWorkoutParts.emomIntervalSeconds,
      rounds: crossfitWorkoutParts.rounds,
      repScheme: crossfitWorkoutParts.repScheme,
      intervalRounds: crossfitWorkoutParts.intervalRounds,
      intervalWorkSeconds: crossfitWorkoutParts.intervalWorkSeconds,
      intervalRestSeconds: crossfitWorkoutParts.intervalRestSeconds,
      movementCategory: movements.category,
      actualWeight: scoreMovementDetails.actualWeight,
      setEntries: scoreMovementDetails.setEntries,
    })
    .from(scoreMovementDetails)
    .innerJoin(scores, eq(scores.id, scoreMovementDetails.scoreId))
    .innerJoin(
      crossfitWorkoutMovements,
      eq(
        crossfitWorkoutMovements.id,
        scoreMovementDetails.crossfitWorkoutMovementId
      )
    )
    .innerJoin(
      crossfitWorkoutParts,
      eq(crossfitWorkoutParts.id, crossfitWorkoutMovements.crossfitWorkoutPartId)
    )
    .innerJoin(movements, eq(movements.id, crossfitWorkoutMovements.movementId))
    .where(
      and(
        eq(scores.userId, userId),
        eq(crossfitWorkoutMovements.movementId, movementId),
        sql`${scores.createdAt} >= ${cutoff.toISOString()}`
      )
    );

  const weights: number[] = [];
  for (const r of rows) {
    const cls = classifyStimulus({
      workoutType: r.partWorkoutType,
      timeCapSeconds: r.timeCapSeconds,
      amrapDurationSeconds: r.amrapDurationSeconds,
      emomIntervalSeconds: r.emomIntervalSeconds,
      rounds: r.rounds,
      repScheme: r.repScheme,
      intervalRounds: r.intervalRounds as PartForClassification["intervalRounds"],
      intervalWorkSeconds: r.intervalWorkSeconds,
      intervalRestSeconds: r.intervalRestSeconds,
      movementCategories: [r.movementCategory],
    });
    if (cls !== stimulusClass) continue;
    const w = representativeWeightFromHistory({
      scoreId: "",
      workoutDate: "",
      actualWeight: r.actualWeight != null ? Number(r.actualWeight) : null,
      setEntries: r.setEntries as DirectHistoryRow["setEntries"],
      rpe: null,
    });
    if (w != null && w > 0) weights.push(w);
  }
  return weights;
}

function suggestFromSimilarHistory(
  weights: number[],
  stimulusClass: StimulusClass
): SuggestedWeight | null {
  if (weights.length < 2) return null;
  const avg = weights.reduce((a, b) => a + b, 0) / weights.length;
  return {
    method: "similar_template_history",
    confidence: "medium",
    lowLb: roundToPlate(avg * 0.92),
    highLb: roundToPlate(avg * 1.05),
    anchor1rmLb: null,
    anchorSource: `Avg of ${weights.length} recent ${stimulusClassLabel(stimulusClass)} sets`,
    stimulusClass,
  };
}

function stimulusClassLabel(cls: StimulusClass): string {
  switch (cls) {
    case "strength_heavy": return "heavy-strength";
    case "strength_moderate": return "moderate-strength";
    case "short_intense": return "short metcon";
    case "moderate_metcon": return "moderate metcon";
    case "long_metcon": return "long metcon";
    case "oly_metcon": return "olympic-flavored";
  }
}

function rxFallback(
  m: MovementSuggestionInput,
  user: CtxUser,
  stimulusClass: StimulusClass | null
): SuggestedWeight | null {
  const rxLb = pickRxWeight(m, user.gender);
  if (rxLb == null) return null;
  return {
    method: "rx_fallback",
    confidence: "low",
    lowLb: roundToPlate(rxLb * 0.85),
    highLb: roundToPlate(rxLb),
    anchor1rmLb: null,
    anchorSource: "Gym Rx baseline",
    stimulusClass,
  };
}

interface StrengthRow {
  estimated1rmLb: number;
  source: string;
  sourceSetWeightLb: number | null;
  sourceSetReps: number | null;
  lastObservedAt: Date;
}

async function loadStrengthMap(
  userId: string,
  movementIds: string[]
): Promise<Map<string, StrengthRow>> {
  if (movementIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(athleteMovementStrength)
    .where(
      and(
        eq(athleteMovementStrength.userId, userId),
        inArray(athleteMovementStrength.movementId, movementIds)
      )
    );
  const out = new Map<string, StrengthRow>();
  for (const r of rows) {
    out.set(r.movementId, {
      estimated1rmLb: Number(r.estimated1rmLb),
      source: r.source,
      sourceSetWeightLb:
        r.sourceSetWeightLb != null ? Number(r.sourceSetWeightLb) : null,
      sourceSetReps: r.sourceSetReps,
      lastObservedAt: r.lastObservedAt,
    });
  }
  return out;
}

function describeStrength(s: StrengthRow): string {
  const date = formatDateShort(s.lastObservedAt);
  if (s.source === "logged_1rm") return `Logged 1RM (${date})`;
  if (s.sourceSetWeightLb && s.sourceSetReps) {
    return `Estimated from ${s.sourceSetReps} × ${s.sourceSetWeightLb} lb (${date})`;
  }
  return `Estimated 1RM (${date})`;
}

/**
 * Main entry point: produce a suggestion for every weighted movement in
 * `part`. Movements that aren't weighted return `unavailable` so the UI
 * can still iterate the array uniformly.
 */
export async function suggestWeightsForPart(
  user: CtxUser,
  part: PartSuggestionInput
): Promise<Map<string, SuggestedWeight>> {
  const out = new Map<string, SuggestedWeight>();
  const stimulusClass = classifyStimulus(part);

  const weighted = part.movements.filter((m) => m.isWeighted);
  const strengthMap = await loadStrengthMap(
    user.id,
    weighted.map((m) => m.movementId)
  );

  // Pre-load bands for the unique (stimulusClass, category) combos.
  const bandCache = new Map<string, { low: number; high: number } | null>();
  async function getBand(cat: string) {
    const key = `${stimulusClass}:${cat}`;
    if (bandCache.has(key)) return bandCache.get(key)!;
    const band = await getStimulusBand(stimulusClass, cat);
    bandCache.set(key, band);
    return band;
  }

  for (const m of part.movements) {
    if (!m.isWeighted) {
      out.set(m.crossfitWorkoutMovementId, {
        method: "unavailable",
        confidence: "low",
        lowLb: 0,
        highLb: 0,
        stimulusClass,
      });
      continue;
    }

    // 1. Direct same-template history
    const direct = await findDirectHistory(user.id, m);
    const directSuggestion = suggestFromDirectHistory(direct, stimulusClass);
    if (directSuggestion) {
      out.set(m.crossfitWorkoutMovementId, directSuggestion);
      continue;
    }

    // 2/3. Logged or estimated 1RM
    const strength = strengthMap.get(m.movementId);
    if (strength) {
      const band = await getBand(m.movementCategory);
      if (band) {
        const isLogged = strength.source === "logged_1rm";
        const conf: SuggestedWeightConfidence = isLogged
          ? "high"
          : "medium";
        out.set(
          m.crossfitWorkoutMovementId,
          suggestFromOneRm(
            strength.estimated1rmLb,
            strength.source,
            band,
            stimulusClass,
            conf,
            describeStrength(strength)
          )
        );
        continue;
      }
    }

    // 3.5. Movement history across templates — catches non-1RM movements
    // (dumbbell, kettlebell, sandbag) that have prior logs on other
    // templates. Same-template logs are excluded (tier 1's job).
    const movementHistory = await findMovementHistoryAnyTemplate(
      user.id,
      m.movementId,
      m.crossfitWorkoutId
    );
    if (movementHistory.length > 0) {
      const todayPrescribed = pickTodaysPrescribed(m, user.gender);
      // Take the most-recent row (already sorted desc) — we trust recency
      // over averaging here since stimulus class can vary between templates.
      const priorRow = movementHistory[0];
      const priorPrescribed = pickPriorPrescribed(priorRow, user.gender);
      const fromHistory = suggestFromMovementHistory(
        priorRow,
        todayPrescribed,
        priorPrescribed,
        stimulusClass
      );
      if (fromHistory) {
        out.set(m.crossfitWorkoutMovementId, fromHistory);
        continue;
      }
    }

    // 4. Similar-stimulus history
    const similarWeights = await findSimilarStimulusHistory(
      user.id,
      m.movementId,
      stimulusClass
    );
    const similar = suggestFromSimilarHistory(similarWeights, stimulusClass);
    if (similar) {
      out.set(m.crossfitWorkoutMovementId, similar);
      continue;
    }

    // 5. Rx fallback
    const fallback = rxFallback(m, user, stimulusClass);
    if (fallback) {
      out.set(m.crossfitWorkoutMovementId, fallback);
      continue;
    }

    out.set(m.crossfitWorkoutMovementId, {
      method: "unavailable",
      confidence: "low",
      lowLb: 0,
      highLb: 0,
      stimulusClass,
    });
  }

  return out;
}

/**
 * Load the catalog metadata you need to build `MovementSuggestionInput` for
 * a list of crossfit_workout_movement ids. Useful in API routes that have
 * the cwm ids but not yet the catalog rows.
 */
export async function loadMovementSuggestionInputs(
  crossfitWorkoutMovementIds: string[]
): Promise<MovementSuggestionInput[]> {
  if (crossfitWorkoutMovementIds.length === 0) return [];
  const rows = await db
    .select({
      cwmId: crossfitWorkoutMovements.id,
      crossfitWorkoutId: crossfitWorkoutMovements.crossfitWorkoutId,
      movementId: crossfitWorkoutMovements.movementId,
      category: movements.category,
      is1rmApplicable: movements.is1rmApplicable,
      isWeighted: movements.isWeighted,
      rxStimulusClass: movements.rxStimulusClass,
      commonRxWeightMale: movements.commonRxWeightMale,
      commonRxWeightFemale: movements.commonRxWeightFemale,
      prescribedWeightMale: crossfitWorkoutMovements.prescribedWeightMale,
      prescribedWeightFemale: crossfitWorkoutMovements.prescribedWeightFemale,
    })
    .from(crossfitWorkoutMovements)
    .innerJoin(movements, eq(movements.id, crossfitWorkoutMovements.movementId))
    .where(inArray(crossfitWorkoutMovements.id, crossfitWorkoutMovementIds));

  return rows.map((r) => ({
    crossfitWorkoutMovementId: r.cwmId,
    crossfitWorkoutId: r.crossfitWorkoutId,
    movementId: r.movementId,
    movementCategory: r.category,
    is1rmApplicable: r.is1rmApplicable,
    isWeighted: r.isWeighted,
    rxStimulusClass: (r.rxStimulusClass ?? null) as StimulusClass | null,
    commonRxWeightMale:
      r.commonRxWeightMale != null ? Number(r.commonRxWeightMale) : null,
    commonRxWeightFemale:
      r.commonRxWeightFemale != null ? Number(r.commonRxWeightFemale) : null,
    prescribedWeightMale:
      r.prescribedWeightMale != null ? Number(r.prescribedWeightMale) : null,
    prescribedWeightFemale:
      r.prescribedWeightFemale != null ? Number(r.prescribedWeightFemale) : null,
  }));
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function daysBetween(workoutDate: string, ref: Date): number {
  const wd = new Date(workoutDate);
  return Math.round((ref.getTime() - wd.getTime()) / (24 * 60 * 60 * 1000));
}

function formatDateShort(d: Date): string {
  // YYYY-MM-DD — locale-independent, suitable for the Why? sheet.
  return d.toISOString().slice(0, 10);
}
