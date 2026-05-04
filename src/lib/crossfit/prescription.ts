// ============================================
// Prescription resolution + formatting
// ============================================
//
// Single source of truth for turning a movement's structured prescription
// (reps, weight, BW multiplier, duration, height, tempo, equipment count)
// into a human-readable string.
//
// Three places used to fork this logic — workout-card, score-entry, and
// the AI notes-extraction prompt. Routing them through one function:
//   1) keeps display consistent across surfaces;
//   2) lets BW-multiplier prescriptions resolve to a concrete weight in
//      the AI prompt (so "Rx 247 lb" beats "Rx 1.5× BW") whenever the
//      athlete has logged their bodyweight;
//   3) makes adding new fields (tempo, vest hooks later, etc.) a single
//      surgery instead of three.
//
// `units` is "metric" | "mixed" — only affects weight rendering. For now
// we keep weights in lb regardless because that's what the CrossFit
// module stores; the kg conversion happens at display time in callers
// that already convert (none today).

import type { MovementMetricType, WorkoutMovementDisplay } from "@/types/crossfit";
import { formatSecondsAsClock } from "./duration-parser";

type Gender = "male" | "female" | "other" | null;

interface PrescriptionLikeMovement {
  movementName: string;
  metricType: MovementMetricType;
  prescribedReps?: string | null;
  prescribedWeightMale?: string | number | null;
  prescribedWeightFemale?: string | number | null;
  prescribedCaloriesMale?: string | number | null;
  prescribedCaloriesFemale?: string | number | null;
  prescribedDistanceMale?: string | number | null;
  prescribedDistanceFemale?: string | number | null;
  prescribedDurationSecondsMale?: number | null;
  prescribedDurationSecondsFemale?: number | null;
  prescribedHeightInches?: number | string | null;
  prescribedWeightMaleBwMultiplier?: number | string | null;
  prescribedWeightFemaleBwMultiplier?: number | string | null;
  tempo?: string | null;
  equipmentCount?: number | null;
}

function num(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// ============================================
// Resolve effective Rx weight in lb for a gender
// ============================================
//
// Preference order (per spec):
//   1) absolute lb when set (preferred even if a multiplier is also set)
//   2) BW multiplier × user bodyweight (when bodyweight is known)
//   3) null (caller renders "1.5× BW" symbolically or hides Rx)
//
// "other" gender resolves to whichever side has a value (male first), to
// match notes-extraction's existing behavior.

export function resolveRxWeightLb(
  gender: Gender,
  mov: PrescriptionLikeMovement,
  userBodyWeightLb: number | null
): number | null {
  const male = num(mov.prescribedWeightMale);
  const female = num(mov.prescribedWeightFemale);
  const maleMult = num(mov.prescribedWeightMaleBwMultiplier);
  const femaleMult = num(mov.prescribedWeightFemaleBwMultiplier);

  if (gender === "female") {
    if (female != null) return female;
    if (femaleMult != null && userBodyWeightLb != null) {
      return Math.round(femaleMult * userBodyWeightLb);
    }
    if (male != null) return male;
    if (maleMult != null && userBodyWeightLb != null) {
      return Math.round(maleMult * userBodyWeightLb);
    }
    return null;
  }
  // male / other / null all default to male side first.
  if (male != null) return male;
  if (maleMult != null && userBodyWeightLb != null) {
    return Math.round(maleMult * userBodyWeightLb);
  }
  if (female != null) return female;
  if (femaleMult != null && userBodyWeightLb != null) {
    return Math.round(femaleMult * userBodyWeightLb);
  }
  return null;
}

// ============================================
// Format a prescription as a single human-readable string
// ============================================
//
// Examples:
//   "21 Thrusters (95/65 lb)"
//   "10 Back Squats @ 30X1 (1.5× BW = 247 lb)"
//   "L-Sit (:30)"
//   "15 Burpees in :40"
//   "Push-Ups (4 in deficit)"
//
// `units` reserved for future kg/lb display toggle. Today we always render
// in lb because that's what the data is stored in; CrossFit's UnitToggle
// is a HYROX-side concern.

export function formatMovementPrescription(
  mov: PrescriptionLikeMovement,
  gender: Gender,
  userBodyWeightLb: number | null,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  units: "metric" | "mixed" = "mixed"
): string {
  const segments: string[] = [];

  // Reps prefix — "21 Thruster" / "30 reps"
  const reps = (mov.prescribedReps ?? "").trim();

  // Header bit (movement name) is left out of this function — callers
  // typically render the name themselves. The function returns the
  // prescription DETAILS, joined with `·` separators inside parens at the
  // call site.

  // Reps
  if (reps) segments.push(reps);

  // Duration — "for :30", "in :40"
  const durMale = mov.prescribedDurationSecondsMale ?? null;
  const durFemale = mov.prescribedDurationSecondsFemale ?? null;
  if (durMale != null || durFemale != null) {
    const m = durMale != null ? formatSecondsAsClock(durMale) : null;
    const f = durFemale != null ? formatSecondsAsClock(durFemale) : null;
    let label: string;
    if (m && f && m === f) label = m;
    else if (m && f) label = `${m}/${f}`;
    else label = (m || f) ?? "";
    if (label) {
      // If reps are also prescribed, this reads more naturally as "in :40"
      // ("15 burpees in :40"). If duration is the only signal, just show it.
      segments.push(reps ? `in ${label}` : label);
    }
  }

  // Weight — prefer absolute; fall back to BW multiplier (resolved if
  // bodyweight is known, symbolic otherwise).
  const male = num(mov.prescribedWeightMale);
  const female = num(mov.prescribedWeightFemale);
  if (male != null || female != null) {
    const prefix =
      mov.equipmentCount && mov.equipmentCount > 1
        ? `${mov.equipmentCount} × `
        : "";
    const m = male != null ? `${male}` : "?";
    const f = female != null ? `${female}` : null;
    segments.push(`${prefix}${m}${f ? `/${f}` : ""} lb`);
  } else {
    const maleMult = num(mov.prescribedWeightMaleBwMultiplier);
    const femaleMult = num(mov.prescribedWeightFemaleBwMultiplier);
    if (maleMult != null || femaleMult != null) {
      const resolved = resolveRxWeightLb(gender, mov, userBodyWeightLb);
      const mult = gender === "female"
        ? femaleMult ?? maleMult
        : maleMult ?? femaleMult;
      if (mult != null) {
        if (resolved != null) {
          segments.push(`${formatMultiplier(mult)}× BW = ${resolved} lb`);
        } else {
          segments.push(`${formatMultiplier(mult)}× BW`);
        }
      }
    }
  }

  // Calories — values may be scalars ("21") or rep schemes ("75-50-25").
  const calMale =
    mov.prescribedCaloriesMale != null && String(mov.prescribedCaloriesMale).trim() !== ""
      ? String(mov.prescribedCaloriesMale)
      : null;
  const calFemale =
    mov.prescribedCaloriesFemale != null && String(mov.prescribedCaloriesFemale).trim() !== ""
      ? String(mov.prescribedCaloriesFemale)
      : null;
  if (calMale != null || calFemale != null) {
    const m = calMale ?? "?";
    const f = calFemale ?? null;
    segments.push(`${m}${f ? `/${f}` : ""} cal`);
  }

  // Distance (m) — values may be scalars ("400") or schemes ("800-400-200").
  const dMale =
    mov.prescribedDistanceMale != null && String(mov.prescribedDistanceMale).trim() !== ""
      ? String(mov.prescribedDistanceMale)
      : null;
  const dFemale =
    mov.prescribedDistanceFemale != null && String(mov.prescribedDistanceFemale).trim() !== ""
      ? String(mov.prescribedDistanceFemale)
      : null;
  if (dMale != null || dFemale != null) {
    const m = dMale ?? "?";
    const f = dFemale ?? null;
    segments.push(`${m}${f ? `/${f}` : ""} m`);
  }

  // Height (in)
  const heightIn = num(mov.prescribedHeightInches);
  if (heightIn != null) {
    segments.push(`${formatInches(heightIn)} in`);
  }

  // Tempo
  if (mov.tempo && mov.tempo.trim()) {
    segments.push(`@ ${mov.tempo.trim()}`);
  }

  return segments.join(" · ");
}

function formatMultiplier(mult: number): string {
  // "1.5", "1", "0.75" — strip trailing zeros for nicer display.
  const fixed = mult.toFixed(2);
  return fixed.replace(/\.?0+$/, "");
}

function formatInches(n: number): string {
  // Allow fractional values (3.5") but strip trailing zeros.
  const fixed = n.toFixed(2);
  return fixed.replace(/\.?0+$/, "");
}

// ============================================
// Convenience: mirror the WorkoutMovementDisplay shape exactly so callers
// don't have to adapt their data.
// ============================================

export function formatPrescriptionForDisplay(
  mov: WorkoutMovementDisplay,
  gender: Gender,
  userBodyWeightLb: number | null
): string {
  return formatMovementPrescription(mov, gender, userBodyWeightLb);
}
