import type { StationName } from "@/lib/hyrox-data";
import type { PaceSpec, SessionBlock, SessionMovement } from "@/types/hyrox-plan";
import { ALL_STATIONS_IN_ORDER } from "../rotations";
import { intervalPaceForPhase, racePaceForPhase } from "../calibration";
import { renderRaceDay } from "./rest";
import type { RenderContext, RenderedSession, RenderStationSpec } from "./types";

// ---------------------------------------------------------------------------
// Saturday — the anchor session of the week.
//
// The shape of Saturday shifts week by week, so we drive it from a per-week
// config table rather than purely phase-level logic. This keeps the
// progression readable and tweakable.
// ---------------------------------------------------------------------------

type SatKind =
  | { kind: "intervals"; runs: number; stations: StationName[] | "full_rotation"; coverage: "partial" | "full" }
  | { kind: "half_sim"; stationsGroup: "first_four" | "last_four" | "weakness" }
  | { kind: "full_sim" }
  | { kind: "tune_up"; runs: number; stations: StationName[] }
  | { kind: "race_day" };

// Singles progression — keyed by week 1..18.
// Doubles and Relay derive from this with format-specific adjustments
// applied in the renderer.
const SINGLES_WEEK_PLAN: Record<number, SatKind> = {
  // Phase 1 — Foundation
  1: { kind: "intervals", runs: 4, stations: ["Wall Balls", "Rowing"], coverage: "partial" },
  2: { kind: "intervals", runs: 4, stations: ["Wall Balls", "Rowing", "Burpee Broad Jumps"], coverage: "partial" },
  3: { kind: "intervals", runs: 5, stations: ["Wall Balls", "Rowing", "Burpee Broad Jumps", "Sled Push"], coverage: "partial" },
  // Phase 2 — Base Building
  4: { kind: "intervals", runs: 5, stations: "full_rotation", coverage: "partial" },
  5: { kind: "intervals", runs: 6, stations: "full_rotation", coverage: "partial" },
  6: { kind: "intervals", runs: 6, stations: "full_rotation", coverage: "partial" },
  // Phase 3 — Aerobic Development
  7: { kind: "intervals", runs: 7, stations: "full_rotation", coverage: "full" },
  8: { kind: "half_sim", stationsGroup: "first_four" },
  9: { kind: "intervals", runs: 8, stations: "full_rotation", coverage: "full" },
  10: { kind: "half_sim", stationsGroup: "last_four" },
  // Phase 4 — Threshold Push
  11: { kind: "intervals", runs: 8, stations: "full_rotation", coverage: "full" },
  12: { kind: "full_sim" },
  13: { kind: "intervals", runs: 6, stations: "full_rotation", coverage: "full" },
  // Phase 5 — Race Specificity
  14: { kind: "full_sim" },
  15: { kind: "intervals", runs: 6, stations: "full_rotation", coverage: "partial" },
  16: { kind: "full_sim" },
  // Phase 6 — Peak & Taper
  17: { kind: "tune_up", runs: 4, stations: ["SkiErg", "Sled Push", "Sled Pull", "Wall Balls"] },
  18: { kind: "race_day" },
};

export function renderHyroxDay(ctx: RenderContext, dayOfWeek: number): RenderedSession {
  const cfg = SINGLES_WEEK_PLAN[ctx.week];
  if (!cfg) throw new Error(`No HYROX day config for week ${ctx.week}`);

  switch (cfg.kind) {
    case "race_day":
      return renderRaceDay(dayOfWeek);
    case "intervals":
      return renderIntervals(ctx, dayOfWeek, cfg);
    case "half_sim":
      return renderHalfSimulation(ctx, dayOfWeek, cfg.stationsGroup);
    case "full_sim":
      return renderFullSimulation(ctx, dayOfWeek);
    case "tune_up":
      return renderTuneUp(ctx, dayOfWeek, cfg.runs, cfg.stations);
  }
}

// ---------------------------------------------------------------------------
// Renderers per kind
// ---------------------------------------------------------------------------

function renderIntervals(
  ctx: RenderContext,
  dayOfWeek: number,
  cfg: Extract<SatKind, { kind: "intervals" }>,
): RenderedSession {
  const runs = formatAdjustedRuns(ctx, cfg.runs);
  // Intervals use training-interval pace (tempo + ~15 sec/km), not full
  // race-day pace. Race-day pace lives in the simulation sessions.
  const intervalPace = intervalPaceForPhase(ctx.paceTier, ctx.phase.phaseNumber);
  const stations =
    cfg.stations === "full_rotation" ? [...ALL_STATIONS_IN_ORDER] : cfg.stations;

  const stationMovements = stations.map((s) => buildIntervalStation(ctx, s, cfg.coverage));
  const equipment = dedupe(["running_shoes", ...stationMovements.flatMap((m) => m.equipment)]);

  const runMovement: SessionMovement = {
    name: `${runs} × 1km Run`,
    distanceMeters: 1000,
    paceSpec: { kind: "run_per_km", seconds: intervalPace },
    prescriptionTemplate: `${runs} × {{distance}} @ {{pace}}`,
    restSeconds: 90,
    notes: "Jog the first 200m of each rep to settle, then lock into target pace.",
  };

  const blocks: SessionBlock[] = [
    {
      label: "Main Set",
      movements: [runMovement, ...stationMovements.map((m) => m.movement)],
      restBetweenStationsSeconds: 90,
      coachNote:
        cfg.coverage === "full"
          ? "Treat each station like race day — brisk transitions, move the whole time."
          : "Work to be brisk between run and station. That transition muscle matters.",
    },
  ];

  const title =
    ctx.phase.phaseNumber <= 2
      ? "HYROX Intervals"
      : ctx.phase.phaseNumber === 3
        ? "HYROX Intervals (Benchmark)"
        : "HYROX Intervals (Race Pace)";

  const stationLabel = cfg.stations === "full_rotation" ? "full rotation" : `${stations.length} stations`;
  const paceLabel = ctx.phase.phaseNumber <= 2 ? "Steady interval pace" : "Sharp interval pace";
  const description = `${runs} × 1km with ${stationLabel} between runs. ${paceLabel} — brisk transitions.`;

  const estDuration = Math.round((runs * intervalPace) / 60 + stations.length * 4 + 15);

  return {
    dayOfWeek,
    orderInDay: 1,
    sessionType: "hyrox_day",
    title: titleWithFormat(ctx, title),
    description: descriptionWithFormat(ctx, description),
    paceSpec: { kind: "run_per_km", seconds: intervalPace },
    durationMinutes: estDuration,
    sessionDetail: {
      warmup: "10 min easy jog + 4×20m strides + dynamic hip mobility.",
      blocks,
      cooldown: "10 min walk. Get protein + carbs within 30 minutes.",
      coachNotes: coachNotesForFormat(ctx),
      estimatedDuration: estDuration,
    },
    equipmentRequired: equipment,
  };
}

function renderHalfSimulation(
  ctx: RenderContext,
  dayOfWeek: number,
  group: "first_four" | "last_four" | "weakness",
): RenderedSession {
  const racePace = racePaceForPhase(ctx.paceTier, ctx.phase.phaseNumber);
  const stations: StationName[] =
    group === "first_four"
      ? ALL_STATIONS_IN_ORDER.slice(0, 4) as StationName[]
      : group === "last_four"
        ? ALL_STATIONS_IN_ORDER.slice(4, 8) as StationName[]
        : // 'weakness' — rotate a mix so every simulation covers different stations
          [ALL_STATIONS_IN_ORDER[1], ALL_STATIONS_IN_ORDER[3], ALL_STATIONS_IN_ORDER[5], ALL_STATIONS_IN_ORDER[7]];

  const stationMovements = stations.map((s) => buildFullStation(ctx, s));
  const equipment = dedupe(["running_shoes", ...stationMovements.flatMap((m) => m.equipment)]);

  const runs = ctx.raceFormat === "relay" ? 2 : 4;
  const runMovement: SessionMovement = {
    name: `${runs} × 1km Run`,
    distanceMeters: 1000,
    paceSpec: { kind: "run_per_km", seconds: racePace },
    prescriptionTemplate: `${runs} × {{distance}} @ {{pace}}`,
    notes: "Race-day pacing. Transitions count — keep them under 20 sec.",
  };

  const estDuration = Math.round(
    (runs * racePace) / 60 +
      stations.reduce((acc, s) => acc + ctx.stationTargets.seconds[s], 0) / 60 +
      15,
  );

  return {
    dayOfWeek,
    orderInDay: 1,
    sessionType: "hyrox_day",
    title: titleWithFormat(ctx, "Half Race Simulation"),
    description: descriptionWithFormat(
      ctx,
      `${runs} × 1km + ${stations.length} stations at race distance and race weight. Time the whole thing.`,
    ),
    paceSpec: { kind: "run_per_km", seconds: racePace },
    durationMinutes: estDuration,
    sessionDetail: {
      warmup: "10 min easy jog + strides + station-specific mobility.",
      blocks: [
        {
          label: "Half Simulation",
          movements: [runMovement, ...stationMovements.map((m) => m.movement)],
          restBetweenStationsSeconds: 15,
          coachNote: "Move. Don't rest between. Transitions are part of the time.",
        },
      ],
      cooldown: "10 min walk + mobility. Refuel within 30 min.",
      coachNotes: "Write down your total time. You'll want to compare across phases.",
      estimatedDuration: estDuration,
    },
    equipmentRequired: equipment,
  };
}

function renderFullSimulation(ctx: RenderContext, dayOfWeek: number): RenderedSession {
  if (ctx.raceFormat === "relay") {
    // Relay doesn't race 8 stations solo — render a shortened version instead
    return renderHalfSimulation(ctx, dayOfWeek, "weakness");
  }
  const racePace = racePaceForPhase(ctx.paceTier, ctx.phase.phaseNumber);
  const stations = ALL_STATIONS_IN_ORDER as readonly StationName[];

  const stationMovements = stations.map((s) => buildFullStation(ctx, s));
  const equipment = dedupe(["running_shoes", ...stationMovements.flatMap((m) => m.equipment)]);

  const runs = ctx.raceFormat === "doubles" ? 8 : 8;
  const runMovement: SessionMovement = {
    name: `${runs} × 1km Run`,
    distanceMeters: 1000,
    paceSpec: { kind: "run_per_km", seconds: racePace },
    prescriptionTemplate: `${runs} × {{distance}} @ {{pace}}`,
    notes: "Race-pace on every run. Expect the last 2 to hurt — that's the point.",
  };

  const stationSeconds = stations.reduce((acc, s) => acc + ctx.stationTargets.seconds[s], 0);
  const estDuration = Math.round((runs * racePace) / 60 + stationSeconds / 60 + 20);

  return {
    dayOfWeek,
    orderInDay: 1,
    sessionType: "hyrox_day",
    title: titleWithFormat(ctx, "Full HYROX Simulation"),
    description: descriptionWithFormat(
      ctx,
      "Full 8 × 1km + all 8 stations at race weight. Wear your race kit. Practice nutrition. Time everything.",
    ),
    paceSpec: { kind: "run_per_km", seconds: racePace },
    durationMinutes: estDuration,
    sessionDetail: {
      warmup: "15 min easy jog + 4×30m strides + full mobility. Treat it like race morning.",
      blocks: [
        {
          label: "Full Simulation",
          movements: [runMovement, ...stationMovements.map((m) => m.movement)],
          restBetweenStationsSeconds: 15,
          coachNote: "Dress rehearsal. Shoes, kit, fueling, hydration — everything as race day.",
        },
      ],
      cooldown: "15 min walk + mobility. Big meal within 60 min.",
      coachNotes:
        "Log every split. Look for the station where you lose the most time vs. your Phase 3 benchmarks — that's your biggest race-day opportunity.",
      estimatedDuration: estDuration,
    },
    equipmentRequired: equipment,
  };
}

function renderTuneUp(
  ctx: RenderContext,
  dayOfWeek: number,
  runs: number,
  stations: StationName[],
): RenderedSession {
  // Tune-up is a sharpener, not a sim — use interval pace (tempo + 15)
  const tuneUpPace = intervalPaceForPhase(ctx.paceTier, ctx.phase.phaseNumber);
  const stationMovements = stations.map((s) => buildTuneUpStation(ctx, s));
  const equipment = dedupe(["running_shoes", ...stationMovements.flatMap((m) => m.equipment)]);

  const runMovement: SessionMovement = {
    name: `${runs} × 1km Run`,
    distanceMeters: 1000,
    paceSpec: { kind: "run_per_km", seconds: tuneUpPace },
    prescriptionTemplate: `${runs} × {{distance}} @ {{pace}}`,
    notes: "Crisp running — close to tempo, not grinding.",
  };

  return {
    dayOfWeek,
    orderInDay: 1,
    sessionType: "hyrox_day",
    title: titleWithFormat(ctx, "Station Tune-Up"),
    description: descriptionWithFormat(
      ctx,
      `${runs} × 1km at a sharp interval pace with ${stations.length} half-distance stations. Stay sharp without draining the battery.`,
    ),
    paceSpec: { kind: "run_per_km", seconds: tuneUpPace },
    durationMinutes: 50,
    sessionDetail: {
      warmup: "10 min easy + strides.",
      blocks: [
        {
          label: "Tune-Up",
          movements: [runMovement, ...stationMovements.map((m) => m.movement)],
          restBetweenStationsSeconds: 60,
          coachNote: "Crisp, confident, controlled. No hero attempts.",
        },
      ],
      cooldown: "10 min walk.",
      coachNotes:
        "This week will feel like you're under-training. You aren't. The fitness is banked — race day is 7 days away.",
      estimatedDuration: 50,
    },
    equipmentRequired: equipment,
  };
}

// ---------------------------------------------------------------------------
// Station movement builders
// ---------------------------------------------------------------------------

interface BuiltStationMovement {
  movement: SessionMovement;
  equipment: string[];
}

/** For intervals: short/partial station work between runs. */
function buildIntervalStation(
  ctx: RenderContext,
  station: StationName,
  coverage: "partial" | "full",
): BuiltStationMovement {
  const spec = ctx.stationSpecs[station];
  const fraction = coverage === "full" ? 1 : 0.35;
  const distance = spec.distanceMeters !== undefined ? Math.round(spec.distanceMeters * fraction) : undefined;
  const reps = spec.reps !== undefined ? Math.round(spec.reps * fraction) : undefined;

  // Time target scales with size
  const fullTarget = ctx.stationTargets.seconds[station];
  const targetSeconds = Math.round(fullTarget * fraction);
  const paceSpec: PaceSpec = spec.isMachinePaced && distance
    ? { kind: "per_500m", seconds: Math.round((targetSeconds / distance) * 500) }
    : { kind: "total_seconds", seconds: targetSeconds };

  return {
    movement: {
      name: `${station} (between runs)`,
      ...(spec.weightKg !== undefined ? { weightKg: spec.weightKg } : {}),
      ...(spec.weightKgPerHand !== undefined ? { weightKgPerHand: spec.weightKgPerHand, hands: spec.hands ?? 2 } : {}),
      ...(distance !== undefined ? { distanceMeters: distance } : {}),
      ...(reps !== undefined ? { reps } : {}),
      paceSpec,
      prescriptionTemplate: buildInlineTemplate(spec, distance, reps),
    },
    equipment: equipmentFor(station),
  };
}

/** For simulations: full race-distance and race-weight station. */
function buildFullStation(ctx: RenderContext, station: StationName): BuiltStationMovement {
  const spec = ctx.stationSpecs[station];
  const targetSeconds = ctx.stationTargets.seconds[station];
  const paceSpec: PaceSpec = spec.isMachinePaced && spec.distanceMeters
    ? { kind: "per_500m", seconds: Math.round((targetSeconds / spec.distanceMeters) * 500) }
    : { kind: "total_seconds", seconds: targetSeconds };

  return {
    movement: {
      name: station,
      ...(spec.weightKg !== undefined ? { weightKg: spec.weightKg } : {}),
      ...(spec.weightKgPerHand !== undefined ? { weightKgPerHand: spec.weightKgPerHand, hands: spec.hands ?? 2 } : {}),
      ...(spec.distanceMeters !== undefined ? { distanceMeters: spec.distanceMeters } : {}),
      ...(spec.reps !== undefined ? { reps: spec.reps } : {}),
      paceSpec,
      prescriptionTemplate: buildInlineTemplate(spec, spec.distanceMeters, spec.reps),
      notes: `Target: ${formatTime(targetSeconds)}.`,
    },
    equipment: equipmentFor(station),
  };
}

/** For tune-up: half distance, race weight. */
function buildTuneUpStation(ctx: RenderContext, station: StationName): BuiltStationMovement {
  const spec = ctx.stationSpecs[station];
  const distance = spec.distanceMeters !== undefined ? Math.round(spec.distanceMeters * 0.5) : undefined;
  const reps = spec.reps !== undefined ? Math.round(spec.reps * 0.5) : undefined;
  const targetSeconds = Math.round(ctx.stationTargets.seconds[station] * 0.5);
  const paceSpec: PaceSpec = spec.isMachinePaced && distance
    ? { kind: "per_500m", seconds: Math.round((targetSeconds / distance) * 500) }
    : { kind: "total_seconds", seconds: targetSeconds };

  return {
    movement: {
      name: `${station} (half distance)`,
      ...(spec.weightKg !== undefined ? { weightKg: spec.weightKg } : {}),
      ...(spec.weightKgPerHand !== undefined ? { weightKgPerHand: spec.weightKgPerHand, hands: spec.hands ?? 2 } : {}),
      ...(distance !== undefined ? { distanceMeters: distance } : {}),
      ...(reps !== undefined ? { reps } : {}),
      paceSpec,
      prescriptionTemplate: buildInlineTemplate(spec, distance, reps),
      notes: "Crisp. Don't chase PRs.",
    },
    equipment: equipmentFor(station),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildInlineTemplate(spec: RenderStationSpec, distance?: number, reps?: number): string {
  const hasDistance = distance !== undefined;
  const hasReps = reps !== undefined;
  const hasWeight = spec.weightKg !== undefined || spec.weightKgPerHand !== undefined;

  if (spec.isMachinePaced && hasDistance) return "{{distance}} @ {{pace}}";
  if (hasReps && hasWeight) return "{{reps}} reps @ {{weight}}";
  if (hasDistance && hasWeight) return "{{distance}} @ {{weight}}";
  if (hasDistance) return "{{distance}}";
  if (hasReps) return "{{reps}} reps";
  return "for time";
}

function formatAdjustedRuns(ctx: RenderContext, baseRuns: number): number {
  if (ctx.raceFormat === "relay") return Math.max(2, Math.round(baseRuns * 0.5));
  // doubles runs the full count — each partner does half, but the plan
  // describes solo training; keep the run count.
  return baseRuns;
}

function titleWithFormat(ctx: RenderContext, base: string): string {
  if (ctx.raceFormat === "relay") return `${base} (Relay Prep)`;
  if (ctx.raceFormat === "doubles") return `${base} (Doubles)`;
  return base;
}

function descriptionWithFormat(ctx: RenderContext, base: string): string {
  if (ctx.raceFormat === "doubles") {
    return `${base} If training with a partner, split the run/station work per race rules.`;
  }
  if (ctx.raceFormat === "relay") {
    return `${base} Relay volume is trimmed — keep effort sharp, not grinding.`;
  }
  return base;
}

function coachNotesForFormat(ctx: RenderContext): string {
  if (ctx.raceFormat === "doubles") {
    return "Doubles partners split work 50/50. Practice transitions (tag in/out) if you have a partner; otherwise visualize them.";
  }
  if (ctx.raceFormat === "relay") {
    return "Relay wins are built on fast 1km efforts and clean station handoffs. Don't train the endurance you don't need.";
  }
  return "Transitions are where races are won and lost. Practice them as deliberately as the stations.";
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

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
