// ---------------------------------------------------------------------------
// Pace-tier calibration
//
// All generic plan targets derive from two sources:
//   1. Station times — real race-day quantile distributions from scraped
//      HYROX splits (DIVISION_REF_DATA in src/lib/hyrox-data.ts). We pick a
//      percentile per pace tier: beginner=p50, intermediate=p37 (midpoint of
//      p50 and p25), advanced=p25, elite=p10.
//   2. Run paces — derived from the self-reported comfortable pace range
//      that defines each tier (§2.2 of the spec). Run pace targets are
//      gender-neutral because the pace tier itself is the self-report.
//
// Fallback: for gender-specific doubles/relay variants we don't have ref
// data for (e.g. women_doubles_pro), we fall back to the mixed variant for
// station times. Run paces are not affected since they're gender-neutral.
// ---------------------------------------------------------------------------

import {
  DIVISION_REF_DATA,
  STATION_ORDER,
  type DivisionKey,
  type RefDistribution,
  type StationName,
} from "@/lib/hyrox-data";

export type Gender = "women" | "men";
export type RaceFormat = "singles" | "doubles" | "relay";
export type PaceTier = "beginner" | "intermediate" | "advanced" | "elite";
export type WeightTier = "open" | "pro";

export const PACE_TIERS: readonly PaceTier[] = ["beginner", "intermediate", "advanced", "elite"] as const;
export const GENDERS: readonly Gender[] = ["women", "men"] as const;
export const RACE_FORMATS: readonly RaceFormat[] = ["singles", "doubles", "relay"] as const;

export const SECONDS_PER_MILE_TO_KM = 0.621371;
export const KM_PER_MILE = 1.609344;

/** Convert seconds/mile → seconds/km. */
export function secPerMiToSecPerKm(secPerMi: number): number {
  return Math.round(secPerMi / KM_PER_MILE);
}

/** Convert seconds/km → seconds/mile (useful for display checks). */
export function secPerKmToSecPerMi(secPerKm: number): number {
  return Math.round(secPerKm * KM_PER_MILE);
}

// ---------------------------------------------------------------------------
// Ref data selection
//
// Choose which DIVISION_REF_DATA row to use for a (gender, format,
// weight_tier). Falls back to the closest available variant when the exact
// gender-specific team division isn't scraped.
// ---------------------------------------------------------------------------

export function refDivisionKeyFor(
  gender: Gender,
  format: RaceFormat,
  weightTier: WeightTier,
): DivisionKey {
  if (format === "singles") {
    return `${gender}_${weightTier}` as DivisionKey;
  }
  if (format === "doubles") {
    // We only have ref data for doubles_mixed_* — same station targets are
    // used for women/men doubles, since the stations are gender-specific Rx
    // weights (e.g. women still use the women sled weight). Run paces are
    // gender-neutral via the pace tier.
    return weightTier === "pro" ? "doubles_mixed_pro" : "doubles_mixed_open";
  }
  // relay_mixed is the only relay ref we have; relay is Open-weight only.
  return "relay_mixed";
}

// ---------------------------------------------------------------------------
// Pace-tier percentile picker
// ---------------------------------------------------------------------------

/**
 * Pull the end-of-plan station target (in seconds) for a given distribution
 * at the pace tier's percentile.
 *
 *   beginner     → p50 (median race finisher)
 *   intermediate → midpoint(p50, p25) — effectively p37
 *   advanced     → p25 (faster than 75% of the field)
 *   elite        → p10 (faster than 90% of the field)
 */
export function stationTargetSeconds(dist: RefDistribution, paceTier: PaceTier): number {
  const [p10, p25, p50] = dist;
  switch (paceTier) {
    case "beginner":
      return p50;
    case "intermediate":
      return Math.round((p50 + p25) / 2);
    case "advanced":
      return p25;
    case "elite":
      return p10;
  }
}

// ---------------------------------------------------------------------------
// End-of-plan station targets for a given (gender, format, paceTier, weight)
// ---------------------------------------------------------------------------

export interface StationTargets {
  // total seconds to complete the station at full race-day distance & weight
  seconds: Record<StationName, number>;
}

export function stationTargetsFor(
  gender: Gender,
  format: RaceFormat,
  paceTier: PaceTier,
  weightTier: WeightTier,
): StationTargets {
  const refKey = refDivisionKeyFor(gender, format, weightTier);
  const ref = DIVISION_REF_DATA[refKey];
  if (!ref) {
    throw new Error(`No DIVISION_REF_DATA for ${refKey}`);
  }
  const out = {} as Record<StationName, number>;
  for (const station of STATION_ORDER) {
    const dist = ref.stations[station];
    out[station] = stationTargetSeconds(dist, paceTier);
  }
  return { seconds: out };
}

// ---------------------------------------------------------------------------
// Run pace curves — by pace tier, progressing through phases
//
// The "end-of-plan" tempo pace is the tightest: it's what the athlete holds
// for race-pace tempo runs in Phase 4–5 and shows up as their race-day
// tempo for the 1km segments (with some fatigue buffer added on race day).
// Easier paces flow from this via offsets, not ratios, so the relationship
// stays intuitive at low fitness levels.
// ---------------------------------------------------------------------------

/** End-of-plan tempo pace (seconds/km) by pace tier. */
export const TEMPO_TARGET_SEC_PER_KM: Record<PaceTier, number> = {
  // 9:00/mi = 540/mi → ~336 sec/km
  beginner: 336,
  // 7:15/mi = 435/mi → ~270 sec/km  (matches example plan's race pace)
  intermediate: 270,
  // 6:20/mi = 380/mi → ~236 sec/km
  advanced: 236,
  // 5:45/mi = 345/mi → ~214 sec/km
  elite: 214,
};

/**
 * Multiplier applied to end-of-plan tempo to get each phase's tempo target.
 * Phase 1 is slow (aerobic base), tempos tighten through phase 4, then hold
 * for race specificity and taper.
 */
export const PHASE_TEMPO_MULTIPLIER: Record<number, number> = {
  1: 1.14, // loose
  2: 1.09,
  3: 1.04,
  4: 1.00, // lock in race pace
  5: 1.00,
  6: 1.00,
};

/** Phase-by-phase tempo pace (sec/km) for a given pace tier. */
export function tempoPaceForPhase(paceTier: PaceTier, phase: number): number {
  const base = TEMPO_TARGET_SEC_PER_KM[paceTier];
  const mult = PHASE_TEMPO_MULTIPLIER[phase] ?? 1.0;
  return Math.round(base * mult);
}

/**
 * Easy-run pace — always ~60 sec/km slower than tempo (Zone 2 conversational).
 * This offset is the one the user called out: easy must actually be easy,
 * and pegging it to tempo keeps the relationship honest at every tier.
 */
export const EASY_PACE_OFFSET_SEC_PER_KM = 60;

export function easyPaceForPhase(paceTier: PaceTier, phase: number): number {
  return tempoPaceForPhase(paceTier, phase) + EASY_PACE_OFFSET_SEC_PER_KM;
}

/**
 * Race pace on 1km HYROX segments (race-day) — tempo + ~45 sec/km buffer
 * for station fatigue. Calibrated against Women Open race splits where
 * run-1 is ~8:00/mi and run-8 drifts to ~8:50/mi against a 7:15/mi tempo.
 *
 * Use this for *full simulation* sessions and for race-day predictors.
 */
export function racePaceForPhase(paceTier: PaceTier, phase: number): number {
  return tempoPaceForPhase(paceTier, phase) + 45;
}

/**
 * Interval training pace — tempo + ~15 sec/km buffer. Slightly easier than
 * tempo to make room for station work between reps, but much faster than
 * race-day pace. This is what the Saturday intervals session should
 * prescribe on non-simulation weeks.
 *
 * Matches the example plan's progression (e.g. W4 Sat 8:20/mi tempo → run
 * reps at ~8:20/mi against a tempo of ~8:00/mi).
 */
export function intervalPaceForPhase(paceTier: PaceTier, phase: number): number {
  return tempoPaceForPhase(paceTier, phase) + 15;
}

/**
 * Easy-run duration in minutes, progressing with phase and pace tier.
 * Beginner stays cautious (Couch-to-5K baseline); Elite pushes volume.
 */
export function easyRunMinutesForPhase(paceTier: PaceTier, phase: number): number {
  const base: Record<PaceTier, number> = {
    beginner: 20,      // Phase 1 start
    intermediate: 30,
    advanced: 35,
    elite: 45,
  };
  const growth: Record<PaceTier, number> = {
    beginner: 3,
    intermediate: 4,
    advanced: 4,
    elite: 3,
  };
  // Growth from phase 1 through phase 5; phase 6 tapers back ~25%.
  if (phase === 6) {
    return Math.round((base[paceTier] + growth[paceTier] * 3) * 0.75);
  }
  // Scale phase 1..5 → +0, +1, +2, +3, +3 growth units
  const growthFactor = phase <= 5 ? Math.min(phase - 1, 3) : 3;
  return base[paceTier] + growth[paceTier] * growthFactor;
}

/** Tempo-block duration in minutes (the tempo portion, not including warmup/cooldown). */
export function tempoBlockMinutesForPhase(paceTier: PaceTier, phase: number): number {
  const base: Record<PaceTier, number> = {
    beginner: 8,
    intermediate: 10,
    advanced: 12,
    elite: 15,
  };
  // Grow from phase 1 → 4, hold for 5, shorten for 6 (taper).
  const growth: Record<number, number> = { 1: 0, 2: 6, 3: 12, 4: 15, 5: 15, 6: 6 };
  return base[paceTier] + (growth[phase] ?? 0);
}
