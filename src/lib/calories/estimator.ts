// ============================================================
// Calorie estimator — pure compute.
// ============================================================
// MET-based estimation following the 2024 Adult Compendium of Physical
// Activities. Per-`workoutType` branching matches the time math to the way
// the workout is actually performed (sprint For Time vs. paced AMRAP vs.
// EMOM work/rest pairs vs. strength sets that are mostly rest).
//
// Pure: no DB, no fetch. Callers gather all the inputs and pass them in.

import {
  repsForRound,
  type RepSchemeParsed,
} from "@/lib/crossfit/rep-scheme-parser";
import {
  metForRunPace,
  metForSkiErgPace,
  metForRowPace,
} from "./pace-tables";
import type {
  CaloriePartInput,
  CaloriePartMovement,
  CalorieScoreContext,
  CalorieEstimatorInput,
  CalorieEstimate,
  PartEstimate,
  Confidence,
} from "./types";

export const LB_PER_KG = 2.20462;
export const REFERENCE_KG = 75;
export const POPULATION_DEFAULT_LB = {
  male: 165,
  female: 137,
  unknown: 150,
} as const;

// Fallback MET when a movement has none seeded — vigorous circuit (02040).
const FALLBACK_MOVEMENT_MET = 7.5;
// MET at rest states (hardcoded, not on movements).
const MET_ACTIVE_REST = 3.0; // walking, shuffling
const MET_LIGHT_WALK = 2.5;  // between intervals
const MET_STANDING_REST = 1.5;
const MET_TABATA_REST = 2.0; // sustained pace, not full rest

// Load-relative MET scaling. A movement worked near 1RM costs more energy per
// rep than the same movement at a light metcon load. `loadPct1rm` is the
// working weight as a fraction of the athlete's estimated 1RM; the curve is
// centered so a typical metcon load (~60% of 1RM) is neutral, and the factor
// is self-clamped so load alone never swings a movement's MET past ±20%.
const LOAD_REFERENCE_PCT = 0.6;
const LOAD_MET_SENSITIVITY = 0.6;
const LOAD_PCT_FLOOR = 0.2;
const LOAD_PCT_CEIL = 1.0;
const LOAD_FACTOR_MIN = 0.82;
const LOAD_FACTOR_MAX = 1.2;

// Barbell-complex adjustments (workout_parts.structure === "complex"). An
// unbroken complex chains every movement on one bar without setting it down,
// so: fatigued reps run slower than the broken-set population default, the
// sustained continuous tension pushes the working MET above the discrete-rep
// compendium values, and the inter-set rest is active recovery rather than a
// standing rest.
const COMPLEX_REP_TIME_FACTOR = 1.3;
const COMPLEX_MET_BONUS = 1.0;
const MET_COMPLEX_REST = 2.0;

const CONFIDENCE_ORDER: Confidence[] = ["high", "medium", "low"];
function lowestConfidence(values: Confidence[]): Confidence {
  let lowestIdx = 0;
  for (const v of values) {
    const idx = CONFIDENCE_ORDER.indexOf(v);
    if (idx > lowestIdx) lowestIdx = idx;
  }
  return CONFIDENCE_ORDER[lowestIdx];
}
function downgrade(c: Confidence): Confidence {
  const idx = CONFIDENCE_ORDER.indexOf(c);
  return CONFIDENCE_ORDER[Math.min(idx + 1, CONFIDENCE_ORDER.length - 1)];
}

/**
 * Pick the athlete's bodyweight in kg from the most specific source available.
 * Returns `isDefault: true` when we fell back to a population value so the
 * caller can demote confidence.
 */
export function resolveBodyweightKg(input: {
  bodyWeightLb: number | null | undefined;
  gender: string | null | undefined;
}): { kg: number; isDefault: boolean } {
  if (input.bodyWeightLb != null && input.bodyWeightLb > 0) {
    return { kg: input.bodyWeightLb / LB_PER_KG, isDefault: false };
  }
  const key =
    input.gender === "male" || input.gender === "female" ? input.gender : "unknown";
  return { kg: POPULATION_DEFAULT_LB[key] / LB_PER_KG, isDefault: true };
}

function repSecondsFor(m: CaloriePartMovement): number {
  if (m.userRepSecondsObserved != null && m.userRepSecondsObserved > 0) {
    return m.userRepSecondsObserved;
  }
  if (m.movement.repSecondsDefault != null && m.movement.repSecondsDefault > 0) {
    return m.movement.repSecondsDefault;
  }
  // Reasonable fallback for movements we haven't seeded yet.
  return 3.0;
}

/**
 * Total reps prescribed for one movement across the part's rounds.
 * Used to weight time-share across the movements in a metcon. AMRAP rounds
 * count the rep scheme once (since "rounds" is the score, not a prescription).
 */
function prescribedRepsForPart(
  m: CaloriePartMovement,
  part: CaloriePartInput
): number {
  const parsed = m.repSchemeParsed ?? part.repSchemeParsed;
  const rounds =
    part.workoutType === "amrap" || part.workoutType === "for_calories"
      ? 1
      : part.rounds ?? (parsed?.kind === "sequence" ? parsed.reps.length : 1);
  if (parsed) {
    let total = 0;
    for (let i = 0; i < rounds; i++) total += repsForRound(parsed, i);
    if (total > 0) return total;
  }
  // No parsed scheme — try the movement's own prescribed value as a number.
  const direct = m.prescribedReps ? parseInt(m.prescribedReps, 10) : NaN;
  if (Number.isFinite(direct) && direct > 0) return direct * rounds;
  return 0;
}

/**
 * Distance prescribed for paced run/erg movements. Used to derive a target
 * pace when the athlete's time isn't logged.
 */
function prescribedDistanceMeters(m: CaloriePartMovement): number | null {
  if (m.prescribedDistanceMeters != null && m.prescribedDistanceMeters > 0) {
    return m.prescribedDistanceMeters;
  }
  return null;
}

/**
 * MET for a paced movement, given a target pace estimate. Uses prescribed
 * distance plus the part's `amrapDurationSeconds` / `timeCapSeconds` as a
 * coarse pace proxy. Falls back to a moderate-effort MET when we can't.
 */
function pacedMet(
  m: CaloriePartMovement,
  part: CaloriePartInput,
  sessionSec: number
): number {
  const meters = prescribedDistanceMeters(m);
  // Runs: estimate sec/km from prescribed distance and the resolved session.
  if (m.movement.isPacedRun) {
    if (meters && meters > 0 && sessionSec > 0) {
      const secPerKm = (sessionSec / meters) * 1000;
      return metForRunPace(secPerKm);
    }
    return 9.3; // 10:00/mi default
  }
  if (m.movement.isPacedErg === "ski") {
    if (meters && meters > 0 && sessionSec > 0) {
      const secPer500 = (sessionSec / meters) * 500;
      return metForSkiErgPace(secPer500);
    }
    return 10.5;
  }
  if (m.movement.isPacedErg === "row") {
    if (meters && meters > 0 && sessionSec > 0) {
      const secPer500 = (sessionSec / meters) * 500;
      return metForRowPace(secPer500);
    }
    return 7.5;
  }
  return FALLBACK_MOVEMENT_MET;
}

/**
 * Apply the modifier cascade: vest, then load-relative-to-1RM, then RPE,
 * then skill/warmup. Clamped to [0.80, 1.30].
 */
export function intensityModifier(
  m: CaloriePartMovement,
  part: CaloriePartInput,
  score: CalorieScoreContext | null | undefined
): number {
  let mult = 1.0;

  // 1. Vest stacks with everything else.
  if (score?.woreVest && score.vestWeightLb && score.vestWeightLb > 0) {
    const vestKg = score.vestWeightLb / LB_PER_KG;
    mult *= 1 + Math.min(0.15, vestKg * 0.0066);
  }

  // 2. Load relative to the athlete's 1RM, when we could derive one.
  //    Continuous (not bucketed) so a 0.62 and a 0.65 working load don't fall
  //    on opposite sides of a cliff. A heavy single-modality lift (e.g. a
  //    near-1RM shoulder press in a barbell complex) earns the full bump;
  //    a light load earns a discount.
  if (m.loadPct1rm != null && m.loadPct1rm > 0) {
    const pct = Math.min(LOAD_PCT_CEIL, Math.max(LOAD_PCT_FLOOR, m.loadPct1rm));
    const loadFactor = 1 + LOAD_MET_SENSITIVITY * (pct - LOAD_REFERENCE_PCT);
    mult *= Math.min(LOAD_FACTOR_MAX, Math.max(LOAD_FACTOR_MIN, loadFactor));
  } else if (score?.rpe != null) {
    // 3. RPE fallback when no 1RM is on file — the common case.
    if (score.rpe >= 9) mult *= 1.1;
    else if (score.rpe <= 5) mult *= 0.9;
  }

  // 4. Warmup demotion.
  if (part.isWarmup) mult *= 0.85;

  return Math.min(1.3, Math.max(0.8, mult));
}

/**
 * Time-weighted average MET across the part's main-task movements. Side
 * cadence is folded in as a small MET bump rather than adding seconds —
 * an EMOM-5-burpees side cadence shouldn't claim 5 burpees worth of clock
 * on top of the main task.
 */
function weightedMovementMet(
  part: CaloriePartInput,
  score: CalorieScoreContext | null | undefined,
  sessionSec: number
): number {
  const main = part.movements.filter((m) => !m.isSideCadence);
  if (main.length === 0) return FALLBACK_MOVEMENT_MET;

  // For each movement, compute (timeShareWeight, MET).
  type Weighted = { weight: number; met: number };
  const rows: Weighted[] = main.map((m) => {
    const baseMet = m.movement.isPacedRun || m.movement.isPacedErg
      ? pacedMet(m, part, sessionSec)
      : m.movement.metValue ?? FALLBACK_MOVEMENT_MET;
    const met = baseMet * intensityModifier(m, part, score);
    const reps = prescribedRepsForPart(m, part);
    const sec = reps * repSecondsFor(m);
    // For paced runs/ergs without rep counts, weight by prescribed distance
    // converted to "seconds" via a moderate pace placeholder. This keeps the
    // movement non-zero even when rep math doesn't apply.
    if (sec <= 0 && (m.movement.isPacedRun || m.movement.isPacedErg)) {
      const meters = prescribedDistanceMeters(m) ?? 0;
      return { weight: Math.max(meters / 4, 30), met };
    }
    return { weight: Math.max(sec, 1), met };
  });

  const totalWeight = rows.reduce((acc, r) => acc + r.weight, 0);
  if (totalWeight <= 0) return FALLBACK_MOVEMENT_MET;
  const weighted =
    rows.reduce((acc, r) => acc + r.weight * r.met, 0) / totalWeight;

  // Side-cadence bump. The spec calls for +0.5 to +1.0 MET proportional to
  // cadence intensity — in practice we don't know the burst movement's MET
  // well enough to do better than a constant per-movement bump.
  const sideMet = part.movements
    .filter((m) => m.isSideCadence)
    .reduce(
      (acc, m) =>
        acc + Math.min(1.0, (m.movement.metValue ?? FALLBACK_MOVEMENT_MET) / 20),
      0
    );

  return Math.min(weighted + sideMet, 20);
}

function applyMet(metWeighted: number, kg: number, seconds: number) {
  if (seconds <= 0) return { kcalTotal: 0, kcalActive: 0 };
  const kcalTotal = (metWeighted * kg * seconds) / 3600;
  const kcalActive = ((metWeighted - 1) * kg * seconds) / 3600;
  return { kcalTotal, kcalActive: Math.max(0, kcalActive) };
}

function resolveDurationSec(
  part: CaloriePartInput,
  score: CalorieScoreContext | null | undefined
): number {
  // 1. Live-logged bracket.
  if (score?.startedAt && score?.endedAt) {
    const diff = (score.endedAt.getTime() - score.startedAt.getTime()) / 1000;
    if (diff > 0) return Math.round(diff);
  }
  // 2. Score's own time field.
  switch (part.workoutType) {
    case "for_time":
    case "for_reps":
    case "for_calories":
      if (score?.timeSeconds && score.timeSeconds > 0) return score.timeSeconds;
      if (score?.hitTimeCap && part.timeCapSeconds) return part.timeCapSeconds;
      if (part.amrapDurationSeconds) return part.amrapDurationSeconds; // for_calories/for_reps AMRAP
      break;
    case "amrap":
      if (part.amrapDurationSeconds) return part.amrapDurationSeconds;
      break;
    case "emom": {
      const intervalSec = part.emomIntervalSeconds ?? 60;
      const rounds = part.rounds ?? 0;
      if (rounds > 0) return intervalSec * rounds;
      break;
    }
    case "intervals": {
      if (part.intervalRounds && part.intervalRounds.length > 0) {
        return part.intervalRounds.reduce((a, r) => a + r.work + r.rest, 0);
      }
      const rounds = part.rounds ?? 0;
      return rounds * ((part.intervalWorkSeconds ?? 0) + (part.intervalRestSeconds ?? 0));
    }
    case "tabata":
      return 8 * (20 + 10);
    case "max_effort":
      return 300;
  }
  // 3. Time cap fallback.
  if (score?.hitTimeCap && part.timeCapSeconds) return part.timeCapSeconds;
  if (part.timeCapSeconds) return part.timeCapSeconds;
  // 4. Any logged time (e.g. Murph logged as a freeform "other" part with
  //    a total time but no rep math).
  if (score?.timeSeconds && score.timeSeconds > 0) return score.timeSeconds;
  // 5. Sum-of-rep-times last resort.
  const repSec = part.movements
    .filter((m) => !m.isSideCadence)
    .reduce(
      (acc, m) => acc + prescribedRepsForPart(m, part) * repSecondsFor(m),
      0
    );
  return Math.round(repSec * (part.rounds ?? 1));
}

function confidenceFor(
  part: CaloriePartInput,
  usedFallback: boolean
): Confidence {
  let c: Confidence = "high";
  const hasEstimatedMovement = part.movements.some(
    (m) => m.movement.metIsEstimated
  );
  if (hasEstimatedMovement) c = downgrade(c);
  // Per-movement rep-time-default demotion, capped at one demotion per part.
  const usingPopulationPace = part.movements.some(
    (m) =>
      !m.isSideCadence &&
      !m.movement.isPacedRun &&
      !m.movement.isPacedErg &&
      m.userRepSecondsObserved == null
  );
  if (usingPopulationPace) c = downgrade(c);
  if (usedFallback) c = downgrade(c);
  return c;
}

// ---------- Per-workoutType branches ----------

function estimateForTime(part: CaloriePartInput, input: CalorieEstimatorInput) {
  const score = input.scoreContext ?? null;
  const sessionSec = resolveDurationSec(part, score);
  const weightedMet = weightedMovementMet(part, score, sessionSec);
  const blended = 0.95 * weightedMet + 0.05 * MET_ACTIVE_REST;
  const out = applyMet(blended, input.bodyweightKg, sessionSec);
  return {
    ...out,
    confidence: confidenceFor(part, false),
  };
}

function estimateAmrap(part: CaloriePartInput, input: CalorieEstimatorInput) {
  const score = input.scoreContext ?? null;
  const sessionSec = part.amrapDurationSeconds ?? resolveDurationSec(part, score);
  const weightedMet = weightedMovementMet(part, score, sessionSec);
  const blended = 0.85 * weightedMet + 0.15 * MET_ACTIVE_REST;
  const out = applyMet(blended, input.bodyweightKg, sessionSec);
  return { ...out, confidence: confidenceFor(part, false) };
}

function estimateEmom(part: CaloriePartInput, input: CalorieEstimatorInput) {
  const score = input.scoreContext ?? null;
  const intervalSec = part.emomIntervalSeconds ?? 60;
  const rounds = part.rounds ?? 0;
  const main = part.movements.filter((m) => !m.isSideCadence);
  const workPerRound = main.reduce(
    (acc, m) => acc + prescribedRepsForPart(m, part) * repSecondsFor(m),
    0
  );
  // Cap work-per-round at the interval so reps that exceed the minute don't
  // double-count rest.
  const cappedWork = Math.min(workPerRound, intervalSec);
  const restPerRound = Math.max(0, intervalSec - cappedWork);
  const weightedMet = weightedMovementMet(part, score, intervalSec * rounds);
  const work = applyMet(weightedMet, input.bodyweightKg, cappedWork * rounds);
  const rest = applyMet(MET_STANDING_REST, input.bodyweightKg, restPerRound * rounds);
  return {
    kcalTotal: work.kcalTotal + rest.kcalTotal,
    kcalActive: work.kcalActive + rest.kcalActive,
    confidence: confidenceFor(part, false),
  };
}

function estimateIntervals(part: CaloriePartInput, input: CalorieEstimatorInput) {
  const score = input.scoreContext ?? null;
  const rounds = part.intervalRounds && part.intervalRounds.length > 0
    ? part.intervalRounds
    : Array.from({ length: part.rounds ?? 1 }, () => ({
        work: part.intervalWorkSeconds ?? 0,
        rest: part.intervalRestSeconds ?? 0,
      }));
  const totalWork = rounds.reduce((a, r) => a + r.work, 0);
  const weightedMet = weightedMovementMet(part, score, totalWork);
  let kcalTotal = 0;
  let kcalActive = 0;
  for (const r of rounds) {
    const w = applyMet(weightedMet, input.bodyweightKg, r.work);
    const rest = applyMet(MET_LIGHT_WALK, input.bodyweightKg, r.rest);
    kcalTotal += w.kcalTotal + rest.kcalTotal;
    kcalActive += w.kcalActive + rest.kcalActive;
  }
  return { kcalTotal, kcalActive, confidence: confidenceFor(part, false) };
}

function estimateTabata(part: CaloriePartInput, input: CalorieEstimatorInput) {
  const score = input.scoreContext ?? null;
  const weightedMet = weightedMovementMet(part, score, 20 * 8);
  const work = applyMet(weightedMet, input.bodyweightKg, 20 * 8);
  const rest = applyMet(MET_TABATA_REST, input.bodyweightKg, 10 * 8);
  return {
    kcalTotal: work.kcalTotal + rest.kcalTotal,
    kcalActive: work.kcalActive + rest.kcalActive,
    confidence: "medium" as Confidence,
  };
}

function parseSetCount(parsed: RepSchemeParsed | null, repScheme: string | null): number {
  if (parsed?.kind === "sets") return parsed.sets;
  if (repScheme) {
    const match = repScheme.match(/^(\d+)\s*[x×]\s*\d+$/i);
    if (match) return parseInt(match[1], 10);
  }
  return 5; // sensible default for "5x5" / "5×5"
}

function estimateForLoad(part: CaloriePartInput, input: CalorieEstimatorInput) {
  const score = input.scoreContext ?? null;
  const isComplex = part.structure === "complex";
  const setCount = parseSetCount(part.repSchemeParsed, part.repScheme);
  const main = part.movements.filter((m) => !m.isSideCadence);
  // An unbroken complex never sets the bar down between movements, so its
  // fatigued reps run slower than the broken-set population default.
  const repTimeFactor = isComplex ? COMPLEX_REP_TIME_FACTOR : 1.0;
  const workPerSet = main.reduce(
    (acc, m) => {
      const parsed = m.repSchemeParsed ?? part.repSchemeParsed;
      let reps = 0;
      if (parsed?.kind === "sets") reps = parsed.reps;
      else if (parsed?.kind === "fixed") reps = parsed.reps;
      else reps = 5;
      return acc + reps * repSecondsFor(m) * repTimeFactor;
    },
    0
  );
  // Rest between sets — 180s default, but the EMOM-style hint (rounds + interval)
  // can override.
  const restPerSet = (() => {
    if (part.emomIntervalSeconds && part.rounds) {
      return Math.max(0, part.emomIntervalSeconds - workPerSet);
    }
    return 180;
  })();
  const weightedMet = weightedMovementMet(part, score, (workPerSet + restPerSet) * setCount);
  // A complex sustains continuous tension — grip, bracing, and the inability
  // to reset between movements push the working MET above the discrete-rep
  // compendium values, and its inter-set rest is active recovery rather than
  // a standing rest.
  const workMet = isComplex ? weightedMet + COMPLEX_MET_BONUS : weightedMet;
  const restMet = isComplex ? MET_COMPLEX_REST : MET_STANDING_REST;
  const work = applyMet(workMet, input.bodyweightKg, workPerSet * setCount);
  const rest = applyMet(restMet, input.bodyweightKg, restPerSet * setCount);
  const confidence: Confidence = score?.rpe != null
    ? confidenceFor(part, false)
    : downgrade(confidenceFor(part, false));
  return {
    kcalTotal: work.kcalTotal + rest.kcalTotal,
    kcalActive: work.kcalActive + rest.kcalActive,
    confidence,
  };
}

function estimateMaxEffort(part: CaloriePartInput, input: CalorieEstimatorInput) {
  // Single max attempt — 5 min window at MET 8.0. Calorie estimates aren't
  // the point of a 1RM workout; confidence is intentionally low.
  const out = applyMet(8.0, input.bodyweightKg, 300);
  return { ...out, confidence: "low" as Confidence };
}

function estimateDurationAggregate(part: CaloriePartInput, input: CalorieEstimatorInput) {
  const score = input.scoreContext ?? null;
  const sessionSec = resolveDurationSec(part, score);
  if (sessionSec <= 0) {
    return { kcalTotal: 0, kcalActive: 0, confidence: "low" as Confidence };
  }
  const out = applyMet(FALLBACK_MOVEMENT_MET, input.bodyweightKg, sessionSec);
  return { ...out, confidence: "medium" as Confidence };
}

function estimatePart(part: CaloriePartInput, input: CalorieEstimatorInput) {
  switch (part.workoutType) {
    case "for_time":
      return estimateForTime(part, input);
    case "amrap":
      return estimateAmrap(part, input);
    case "emom":
      return estimateEmom(part, input);
    case "intervals":
      return estimateIntervals(part, input);
    case "tabata":
      return estimateTabata(part, input);
    case "for_load":
      return estimateForLoad(part, input);
    case "for_reps":
      return part.amrapDurationSeconds
        ? estimateAmrap(part, input)
        : part.structure === "tabata"
        ? estimateTabata(part, input)
        : estimateForTime(part, input);
    case "for_calories":
      return part.amrapDurationSeconds
        ? estimateAmrap(part, input)
        : estimateForTime(part, input);
    case "max_effort":
      return estimateMaxEffort(part, input);
    default:
      return estimateDurationAggregate(part, input);
  }
}

export function estimateCalories(input: CalorieEstimatorInput): CalorieEstimate {
  const partResults: PartEstimate[] = input.parts.map((part) => {
    const r = estimatePart(part, input);
    return {
      partId: part.id,
      kcalTotal: r.kcalTotal,
      kcalActive: r.kcalActive,
      confidence: r.confidence,
    };
  });
  const gross = partResults.reduce((a, r) => a + r.kcalTotal, 0);
  const active = partResults.reduce((a, r) => a + r.kcalActive, 0);
  let confidence = lowestConfidence(partResults.map((p) => p.confidence));
  if (input.isDefaultBodyweight) confidence = downgrade(confidence);

  const epoc = Math.max(1, input.epocMultiplier);
  return {
    active: Math.round(active),
    gross: Math.round(gross),
    activeWithEpoc: Math.round(active * epoc),
    grossWithEpoc: Math.round(gross * epoc),
    low: Math.round(active * 0.85),
    high: Math.round(active * 1.15),
    confidence,
    method: "per_part",
    parts: partResults.map((p) => ({
      ...p,
      kcalTotal: Math.round(p.kcalTotal),
      kcalActive: Math.round(p.kcalActive),
    })),
  };
}

// Exported only for tests / admin tooling.
export const __internal = {
  weightedMovementMet,
  intensityModifier,
  resolveDurationSec,
  prescribedRepsForPart,
  repSecondsFor,
};
