import type { StationName } from "@/lib/hyrox-data";
import type { PaceSpec, SessionMovement } from "@/types/hyrox-plan";
import type { RenderContext, RenderedSession, RenderStationSpec } from "./types";

/**
 * Monday and Wednesday — station skills as a 5–15 min add-on after CrossFit.
 *
 * Phase progression:
 *   1 Foundation   — technique, light weights, partial distances
 *   2 Base         — partial/full distance, timed, at race weight
 *   3 Aerobic Dev  — full distance benchmarks
 *   4 Threshold    — target aspirational station times
 *   5 Race Spec    — rehearse at race weight / distance under fatigue
 *   6 Peak & Taper — short sharp efforts, half distance
 */
export function renderStationSkills(
  ctx: RenderContext,
  dayOfWeek: number,
  stations: [StationName, StationName],
): RenderedSession {
  const [a, b] = stations;
  const specA = ctx.stationSpecs[a];
  const specB = ctx.stationSpecs[b];

  const movA = buildStationMovement(ctx, specA);
  const movB = buildStationMovement(ctx, specB);

  const durationMinutes = phaseDurationMinutes(ctx.phase.phaseNumber);
  const equipment = dedupe([...movA.equipmentNeeded, ...movB.equipmentNeeded]);

  const title = `Station Skills — ${short(a)} + ${short(b)}`;
  const description = phaseDescription(ctx.phase.phaseNumber, a, b);

  return {
    dayOfWeek,
    orderInDay: 2, // CrossFit class is order=1 by convention; this is the post-CF add-on
    sessionType: "station_skills",
    title,
    description,
    paceSpec: null,
    durationMinutes,
    sessionDetail: {
      warmup:
        "Coming out of CrossFit, your warmup is already done. Take 60–90 sec to breathe, then go.",
      blocks: [
        {
          label: "Station Skills",
          movements: [movA.movement, movB.movement],
          restBetweenStationsSeconds: 60,
          coachNote: phaseCoachNote(ctx.phase.phaseNumber),
        },
      ],
      cooldown: "2 min walk, then go home.",
      coachNotes:
        "This is a skill session, not a metcon. Stop if your form falls apart — come back fresher next week.",
      estimatedDuration: durationMinutes,
    },
    equipmentRequired: equipment,
  };
}

// ---------------------------------------------------------------------------
// Per-station movement construction — phase-aware
// ---------------------------------------------------------------------------

interface BuiltMovement {
  movement: SessionMovement;
  equipmentNeeded: string[];
}

function buildStationMovement(ctx: RenderContext, spec: RenderStationSpec): BuiltMovement {
  const target = ctx.stationTargets.seconds[spec.name];
  const phase = ctx.phase.phaseNumber;
  const fraction = phaseFraction(phase); // 0.5, 0.75, 1.0, 1.0, 1.0, 0.5

  // Distance/reps scaling
  const distance = spec.distanceMeters !== undefined ? Math.round(spec.distanceMeters * fraction) : undefined;
  const reps = spec.reps !== undefined ? Math.round(spec.reps * fraction) : undefined;

  // Target time scales linearly with distance/reps
  const targetSeconds = Math.round(target * fraction);

  // Weight — Phase 1 is lighter (technique weight), Phase 2+ is race weight
  const weightKg =
    phase === 1
      ? spec.weightKg !== undefined
        ? Math.round(spec.weightKg * 0.7)
        : undefined
      : spec.weightKg;
  const weightKgPerHand =
    phase === 1
      ? spec.weightKgPerHand !== undefined
        ? Math.round(spec.weightKgPerHand * 0.7)
        : undefined
      : spec.weightKgPerHand;

  // Pace spec — machine-paced stations render per-500m; others use total time
  const paceSpec: PaceSpec = spec.isMachinePaced && distance
    ? { kind: "per_500m", seconds: Math.round((targetSeconds / distance) * 500) }
    : { kind: "total_seconds", seconds: targetSeconds };

  // Rep scheme: station skills typically 2–3 sets in phase 1, 1–2 sets in phase 2+
  const sets = phase === 1 ? 3 : phase === 2 ? 2 : 1;

  const notes = phaseMovementNote(phase, spec.name, target);
  const equipmentNeeded = equipmentFor(spec.name);

  const movement: SessionMovement = {
    name: movementName(spec.name, sets, distance, reps),
    paceSpec,
    ...(weightKg !== undefined ? { weightKg } : {}),
    ...(weightKgPerHand !== undefined ? { weightKgPerHand, hands: spec.hands ?? 2 } : {}),
    ...(distance !== undefined ? { distanceMeters: distance } : {}),
    ...(reps !== undefined ? { reps } : {}),
    prescriptionTemplate: buildPrescriptionTemplate(spec, phase, sets),
    notes,
    equipmentNeeded: equipmentNeeded.join(","),
  };

  return { movement, equipmentNeeded };
}

// ---------------------------------------------------------------------------
// Phase-specific scaling and copy
// ---------------------------------------------------------------------------

function phaseFraction(phase: number): number {
  if (phase === 1) return 0.5; // half distances/reps
  if (phase === 6) return 0.5; // taper
  if (phase === 2) return 0.75;
  return 1.0;
}

function phaseDurationMinutes(phase: number): number {
  if (phase === 1) return 8;
  if (phase === 2) return 10;
  if (phase === 3 || phase === 4) return 12;
  if (phase === 5) return 12;
  return 6; // taper
}

function phaseDescription(phase: number, a: string, b: string): string {
  switch (phase) {
    case 1:
      return `Technique intro for ${a} and ${b}. Light weights and shorter distances — find the movement pattern.`;
    case 2:
      return `${a} and ${b} at race weight, partial distance, timed. Start building a baseline.`;
    case 3:
      return `Full race distance for ${a} and ${b}. Benchmark day — time each and log it.`;
    case 4:
      return `Target aspirational times on ${a} and ${b}. This is where the gains show up.`;
    case 5:
      return `Race-weight rehearsal of ${a} and ${b}. Move like race day.`;
    case 6:
      return `Half-distance crisp efforts on ${a} and ${b}. Stay sharp without digging a hole.`;
    default:
      return `${a} and ${b} — follow the prescription.`;
  }
}

function phaseCoachNote(phase: number): string {
  switch (phase) {
    case 1: return "Film yourself on one rep if you can — technique compounds.";
    case 2: return "Warm-up is already done (CrossFit). Go straight in.";
    case 3: return "Time each station. Log it. This is your phase 3 benchmark.";
    case 4: return "Look at your phase 3 time. Try to beat it by 5–10%.";
    case 5: return "This should feel like race-day station movement — controlled, not frantic.";
    case 6: return "Feel quick, not tired. You've banked the fitness.";
    default: return "";
  }
}

function phaseMovementNote(phase: number, station: StationName, targetSeconds: number): string {
  const mm = Math.floor(targetSeconds / 60);
  const ss = String(targetSeconds % 60).padStart(2, "0");
  const full = `${mm}:${ss}`;
  switch (phase) {
    case 1:
      return "Focus on position and breathing. No clock this phase.";
    case 2:
      return `Record your time. End-of-plan full-distance target for this station is ${full}.`;
    case 3:
      return `Full distance. Target ${full} or better.`;
    case 4:
      return `Aim for ${full} — your end-of-plan target.`;
    case 5:
      return `Race-day rehearsal. Target ${full}; focus on smooth transitions.`;
    case 6:
      return "Short and crisp — maintenance only.";
    default:
      return `Target: ${full}`;
  }
}

// ---------------------------------------------------------------------------
// Prescription template assembly — picks placeholders based on station type
// ---------------------------------------------------------------------------

function buildPrescriptionTemplate(spec: RenderStationSpec, phase: number, sets: number): string {
  const setsPrefix = sets > 1 ? `${sets} × ` : "";
  const hasDistance = spec.distanceMeters !== undefined;
  const hasReps = spec.reps !== undefined;
  const hasWeight = spec.weightKg !== undefined || spec.weightKgPerHand !== undefined;
  const isMachine = spec.isMachinePaced;

  // Machine-paced (SkiErg, Rowing): "3 × 500m @ {pace}"
  if (isMachine && hasDistance) {
    return `${setsPrefix}{{distance}} @ {{pace}}`;
  }
  // Wall Balls (reps + weight): "3 × 25 reps @ 4 kg"
  if (hasReps && hasWeight) {
    return `${setsPrefix}{{reps}} reps @ {{weight}}`;
  }
  // Reps only (Burpee Broad Jumps w/ reps): fallback to distance since BBJ has distance
  if (hasReps) {
    return `${setsPrefix}{{reps}} reps`;
  }
  // Distance + weight (Sled Push, Sled Pull, Lunges, Farmers): "3 × 25m @ 102 kg"
  if (hasDistance && hasWeight) {
    return `${setsPrefix}{{distance}} @ {{weight}}`;
  }
  // Distance only (Burpee Broad Jumps in Phase 1): "3 × 40m"
  if (hasDistance) {
    return `${setsPrefix}{{distance}} for time`;
  }
  return `${setsPrefix}for time`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function movementName(station: StationName, sets: number, distance?: number, reps?: number): string {
  if (sets > 1) return `${station} — ${sets} sets`;
  if (distance && reps) return `${station} (${distance}m, ${reps} reps)`;
  if (distance) return `${station} ${distance}m`;
  if (reps) return `${station} ${reps} reps`;
  return station;
}

function equipmentFor(station: StationName): string[] {
  switch (station) {
    case "SkiErg": return ["skierg"];
    case "Rowing": return ["rower"];
    case "Sled Push": return ["sled"];
    case "Sled Pull": return ["sled", "rope"];
    case "Burpee Broad Jumps": return [];
    case "Farmers Carry": return ["kettlebells"];
    case "Sandbag Lunges": return ["sandbag"];
    case "Wall Balls": return ["wall_ball"];
  }
}

function short(station: StationName): string {
  const m: Record<StationName, string> = {
    SkiErg: "Ski",
    "Sled Push": "Push",
    "Sled Pull": "Pull",
    "Burpee Broad Jumps": "BBJ",
    Rowing: "Row",
    "Farmers Carry": "Farmers",
    "Sandbag Lunges": "Lunges",
    "Wall Balls": "WB",
  };
  return m[station];
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
