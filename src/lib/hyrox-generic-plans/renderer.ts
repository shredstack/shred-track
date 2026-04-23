// ---------------------------------------------------------------------------
// Top-level renderer — produces a full 18-week template for a given
// (gender, race_format, pace_tier, weight_tier) tuple.
//
// The output is a plain object that maps 1:1 onto the DB rows the seed
// script inserts. The renderer is pure: given the same inputs, it always
// produces the same output. Keep it that way — we snapshot-test it.
// ---------------------------------------------------------------------------

import {
  DIVISIONS,
  STATION_ORDER,
  formatMovementPrescription,
  type DivisionKey,
  type StationName,
  type StationSpec,
} from "@/lib/hyrox-data";
import type { SessionDetail, SessionMovement } from "@/types/hyrox-plan";

import {
  stationTargetsFor,
  type Gender,
  type RaceFormat,
  type PaceTier,
  type WeightTier,
  type StationTargets,
} from "./calibration";

import { PHASES, phaseForWeek, type GenericPhase } from "./phases";
import { rotationForWeek } from "./rotations";

import type { RenderContext, RenderedSession, RenderStationSpec } from "./sessions/types";
import { renderEasyRun } from "./sessions/easy-run";
import { renderTempo } from "./sessions/tempo";
import { renderStationSkills } from "./sessions/station-skills";
import { renderHyroxDay } from "./sessions/hyrox-day";
import { renderRestOrLight } from "./sessions/rest";

// ---------------------------------------------------------------------------
// Template key + metadata
// ---------------------------------------------------------------------------

export function templateKey(gender: Gender, format: RaceFormat, paceTier: PaceTier): string {
  return `${gender}_${format}_${paceTier}`;
}

export function templateTitle(gender: Gender, format: RaceFormat, paceTier: PaceTier): string {
  const g = gender === "women" ? "Women" : "Men";
  const f = format === "singles" ? "Singles" : format === "doubles" ? "Doubles" : "Relay";
  const t = paceTier.charAt(0).toUpperCase() + paceTier.slice(1);
  return `${g} ${f} — ${t} (18 weeks)`;
}

export function trainingPhilosophy(paceTier: PaceTier, format: RaceFormat): string {
  const runPhilosophy: Record<PaceTier, string> = {
    beginner:
      "This plan builds a running habit first. Most of your running is easy — the engine comes from consistent low-intensity volume, not from hammering every session.",
    intermediate:
      "This plan follows the 80/20 rule: most running is easy, and the hard work lands on Tuesdays (volume), Thursdays (tempo), and Saturdays (race-specific intervals).",
    advanced:
      "This plan assumes you already have an aerobic base. We push tempo duration earlier and add Saturday simulations starting in Phase 3.",
    elite:
      "This plan treats running as a known quantity and pushes race specificity early. Tempo pace is race pace from Phase 4 onward.",
  };
  const formatPhilosophy: Record<RaceFormat, string> = {
    singles:
      "You are training for the full HYROX distance — 8 × (1km + station). Every session builds toward sustaining that unbroken.",
    doubles:
      "Doubles reduces the total work per athlete but compresses transitions. Plan workouts assume solo training; adjust splits if you have a partner.",
    relay:
      "Relay is short, fast, and explosive — 2km run + 2 stations per athlete. Volume drops ~20% and intensity rises.",
  };
  const cfBase =
    "Assume CrossFit 5 days/week Monday–Friday. Station skills are 5–10 min post-CF add-ons, not separate workouts.";
  return `${runPhilosophy[paceTier]} ${formatPhilosophy[format]} ${cfBase}`;
}

// ---------------------------------------------------------------------------
// Station specs — derived from DIVISIONS + gender/weightTier
// ---------------------------------------------------------------------------

function divisionKeyForRx(gender: Gender, format: RaceFormat, weightTier: WeightTier): DivisionKey {
  // For Rx weight lookup: singles/doubles use gender_open/gender_pro;
  // relay is always open-weight gender-matched.
  if (format === "singles") return `${gender}_${weightTier}` as DivisionKey;
  if (format === "doubles") return `doubles_${gender}_${weightTier}` as DivisionKey;
  return `relay_${gender}` as DivisionKey;
}

function buildStationSpecs(gender: Gender, format: RaceFormat, weightTier: WeightTier): Record<StationName, RenderStationSpec> {
  const key = divisionKeyForRx(gender, format, weightTier);
  const division = DIVISIONS[key];
  if (!division) {
    throw new Error(`No DIVISIONS entry for ${key}`);
  }
  const specs = {} as Record<StationName, RenderStationSpec>;
  for (const station of STATION_ORDER) {
    const s = division.stations.find((st) => st.name === station);
    if (!s) throw new Error(`Division ${key} missing station ${station}`);
    specs[station] = toRenderStationSpec(s);
  }
  return specs;
}

function toRenderStationSpec(s: StationSpec): RenderStationSpec {
  const isMachinePaced = s.name === "SkiErg" || s.name === "Rowing";
  const distanceMeters = s.distance ? parseDistanceMeters(s.distance) : undefined;
  // Farmers Carry uses a "2×16 kg" label → render with per-hand weight
  const perHandMatch = s.weightLabel?.match(/^(\d+)\s*×\s*(\d+(?:\.\d+)?)\s*kg/);
  if (s.name === "Farmers Carry" && perHandMatch) {
    return {
      name: s.name as StationName,
      distanceMeters,
      weightKgPerHand: parseFloat(perHandMatch[2]),
      hands: parseInt(perHandMatch[1], 10),
      isMachinePaced,
    };
  }
  return {
    name: s.name as StationName,
    distanceMeters,
    reps: s.reps,
    weightKg: s.weightKg,
    isMachinePaced,
  };
}

/**
 * Walk a session_detail's movements and fill in a `prescription` string on
 * any movement that only has structured fields. Rendered using kg + min/mi
 * as the baseline — the toggle-aware renderer will override at display time
 * once plan-view is wired to formatMovementPrescription.
 */
function withDefaultPrescriptions(detail: SessionDetail): SessionDetail {
  return {
    ...detail,
    blocks: detail.blocks.map((block) => ({
      ...block,
      movements: block.movements.map(fillPrescription),
    })),
  };
}

function fillPrescription(m: SessionMovement): SessionMovement {
  if (m.prescription) return m; // respect any explicit free-text prescription
  const rendered = formatMovementPrescription(m, { paceUnit: "mi", weightUnit: "kg" });
  if (!rendered) return m;
  return { ...m, prescription: rendered };
}

function parseDistanceMeters(label: string): number | undefined {
  // "50m" → 50; "1000m" → 1000; "100 m" → 100
  const m = label.match(/^(\d+)\s*m$/);
  if (!m) return undefined;
  return parseInt(m[1], 10);
}

// ---------------------------------------------------------------------------
// Weekly rendering
// ---------------------------------------------------------------------------

function renderWeek(
  ctxBase: Omit<RenderContext, "week" | "phase" | "rotation">,
  week: number,
): RenderedSession[] {
  const phase = phaseForWeek(week);
  const rotation = rotationForWeek(week);
  const ctx: RenderContext = { ...ctxBase, week, phase, rotation };

  // Day-of-week: 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun
  const sessions: RenderedSession[] = [];

  // Mon — Station Skills (post-CF add-on)
  sessions.push(renderStationSkills(ctx, 0, rotation.mon));

  // Tue — Easy Run
  sessions.push(renderEasyRun(ctx, 1));

  // Wed — Station Skills
  sessions.push(renderStationSkills(ctx, 2, rotation.wed));

  // Thu — Tempo / Race Pace / VO2
  sessions.push(renderTempo(ctx, 3));

  // Fri — Rest or light mobility
  sessions.push(renderRestOrLight(ctx, 4, "friday_light"));

  // Sat — HYROX Day (intervals / simulation / race)
  sessions.push(renderHyroxDay(ctx, 5));

  // Sun — Rest
  sessions.push(renderRestOrLight(ctx, 6, "sunday_rest"));

  return sessions;
}

// ---------------------------------------------------------------------------
// Top-level renderTemplate
// ---------------------------------------------------------------------------

export interface RenderedTemplate {
  templateKey: string;
  gender: Gender;
  raceFormat: RaceFormat;
  paceTier: PaceTier;
  weightTier: WeightTier;
  totalWeeks: number;
  title: string;
  trainingPhilosophy: string;
  phases: GenericPhase[];
  sessions: Array<RenderedSession & { week: number; phaseNumber: number }>;
}

export function renderTemplate(args: {
  gender: Gender;
  raceFormat: RaceFormat;
  paceTier: PaceTier;
  weightTier: WeightTier;
}): RenderedTemplate {
  const { gender, raceFormat, paceTier, weightTier } = args;

  const stationTargets: StationTargets = stationTargetsFor(gender, raceFormat, paceTier, weightTier);
  const stationSpecs = buildStationSpecs(gender, raceFormat, weightTier);

  const ctxBase = {
    gender,
    raceFormat,
    paceTier,
    weightTier,
    stationTargets,
    stationSpecs,
  };

  const sessions: RenderedTemplate["sessions"] = [];
  for (let week = 1; week <= 18; week++) {
    const weekSessions = renderWeek(ctxBase, week);
    const phaseNumber = phaseForWeek(week).phaseNumber;
    for (const s of weekSessions) {
      // Populate a default-unit (kg + min/mi) `prescription` string on each
      // movement so the legacy plan-view renderer has something readable.
      // The structured fields (paceSpec, weightKg, etc.) are retained so
      // future unit-aware rendering can swap them in via the toggle.
      sessions.push({
        ...s,
        sessionDetail: withDefaultPrescriptions(s.sessionDetail),
        week,
        phaseNumber,
      });
    }
  }

  return {
    templateKey: templateKey(gender, raceFormat, paceTier),
    gender,
    raceFormat,
    paceTier,
    weightTier,
    totalWeeks: 18,
    title: templateTitle(gender, raceFormat, paceTier),
    trainingPhilosophy: trainingPhilosophy(paceTier, raceFormat),
    phases: PHASES,
    sessions,
  };
}

// ---------------------------------------------------------------------------
// Enumerate all variants we seed into the DB
// ---------------------------------------------------------------------------

export function allTemplateVariants(): RenderedTemplate[] {
  const out: RenderedTemplate[] = [];
  const paceTiers: PaceTier[] = ["beginner", "intermediate", "advanced", "elite"];
  const genders: Gender[] = ["women", "men"];
  for (const gender of genders) {
    for (const paceTier of paceTiers) {
      // Singles: Open + Pro
      for (const wt of ["open", "pro"] as const) {
        out.push(renderTemplate({ gender, raceFormat: "singles", paceTier, weightTier: wt }));
      }
      // Doubles: Open + Pro
      for (const wt of ["open", "pro"] as const) {
        out.push(renderTemplate({ gender, raceFormat: "doubles", paceTier, weightTier: wt }));
      }
      // Relay: Open only
      out.push(renderTemplate({ gender, raceFormat: "relay", paceTier, weightTier: "open" }));
    }
  }
  return out;
}
