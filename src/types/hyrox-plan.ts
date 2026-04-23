// ---------------------------------------------------------------------------
// HYROX Plan V2 — Types for AI-generated plans
// ---------------------------------------------------------------------------

import type { StationName, DivisionKey, RaceDivisionKey, PaceSpec } from "@/lib/hyrox-data";

// Re-export for backward-compatible imports (types/hyrox-plan is the
// canonical module for consumers of session/plan shapes).
export type { PaceSpec };

// ---------------------------------------------------------------------------
// Session detail (stored in session_detail JSONB)
//
// Structured fields (weight_kg, distance_meters, reps, pace_spec) are the
// preferred way to describe a movement — they round-trip cleanly through
// the unit toggle. `prescription` is retained as a fallback for legacy
// AI-generated plans and for free-text coach notes that don't need unit
// conversion.
// ---------------------------------------------------------------------------

export interface SessionMovement {
  name: string;
  /** Free-text fallback; prefer structured fields below when possible. */
  prescription?: string;
  /** Template string with {{weight}} / {{pace}} / {{distance}} placeholders. */
  prescriptionTemplate?: string;
  weightKg?: number;
  /** Per-hand weight for carries (e.g. Farmers). */
  weightKgPerHand?: number;
  hands?: number;
  distanceMeters?: number;
  reps?: number;
  paceSpec?: PaceSpec;
  rest?: string;
  restSeconds?: number;
  notes?: string;
  equipmentNeeded?: string;
}

export interface SessionBlock {
  label: string;
  movements: SessionMovement[];
  restBetweenStationsSeconds?: number;
  coachNote?: string;
}

export interface SessionDetail {
  warmup?: string;
  blocks: SessionBlock[];
  cooldown?: string;
  coachNotes?: string;
  estimatedDuration: number; // minutes
}

// ---------------------------------------------------------------------------
// Race-day scenario splits
// ---------------------------------------------------------------------------

export interface ScenarioSplit {
  segmentNumber: number;
  segmentType: "run" | "station";
  segmentName: string;
  targetSeconds: number;
  paceDisplay: string;
  strategy: string;
  cumulativeSeconds: number;
}

export interface RaceScenario {
  scenarioLabel: string;
  description: string;
  estimatedFinishSeconds: number;
  bufferSeconds: number | null;
  runStrategy: string;
  splits: ScenarioSplit[];
  analysis: string | null;
  sortOrder: number;
}

// ---------------------------------------------------------------------------
// Plan phase
// ---------------------------------------------------------------------------

export interface PlanPhase {
  phaseNumber: number;
  name: string;
  description: string;
  startWeek: number;
  endWeek: number;
  focusAreas: string[];
}

// ---------------------------------------------------------------------------
// AI generation input (athlete snapshot)
// ---------------------------------------------------------------------------

export interface AthleteSnapshot {
  name: string;
  gender: "women" | "men";
  unit: "metric" | "mixed";
  division: DivisionKey;
  raceDate: string | null;
  goalFinishTimeSeconds: number | null;
  easyPaceSecondsPerUnit: number;
  moderatePaceSecondsPerUnit: number;
  fastPaceSecondsPerUnit: number;
  paceUnit: string;
  hasExperience: boolean;
  previousRaceCount: number;
  bestFinishTimeSeconds: number | null;
  bestDivision: RaceDivisionKey | null;
  bestTimeNotes: string | null;
  crossfitDaysPerWeek: number;
  crossfitGymName: string | null;
  availableEquipment: string[];
  injuriesNotes: string | null;
  trainingPhilosophy: string;
  stationAssessments: {
    station: string;
    completionConfidence: number;
    currentTimeSeconds: number | null;
    goalTimeSeconds: number | null;
  }[];
}

// ---------------------------------------------------------------------------
// AI generation output shapes (what Claude returns)
// ---------------------------------------------------------------------------

export interface AIPlanOverview {
  title: string;
  trainingPhilosophy: string;
  phases: PlanPhase[];
}

export interface AIWeekSession {
  dayOfWeek: number; // 0=Mon … 6=Sun
  sessionType: "run" | "station_skills" | "hyrox_day" | "rest";
  title: string;
  description: string;
  targetPace?: string;
  durationMinutes?: number;
  equipmentRequired: string[];
  detail: SessionDetail;
}

export interface AIWeek {
  weekNumber: number;
  sessions: AIWeekSession[];
}

export interface AIWeekBatch {
  weeks: AIWeek[];
}

// ---------------------------------------------------------------------------
// Equipment substitution map
// ---------------------------------------------------------------------------

export interface Substitution {
  name: string;
  prescription: string;
}

export const STATION_SUBSTITUTIONS: Record<string, Substitution[]> = {
  "Sled Push": [
    { name: "Burpee Broad Jumps", prescription: "40m for time" },
    { name: "Assault Bike Sprint", prescription: "15 cal for time" },
    { name: "Heavy Dumbbell Walking Lunges", prescription: "50m for time" },
  ],
  "Sled Pull": [
    { name: "Seated Band Pull", prescription: "50m hand-over-hand with resistance band" },
    { name: "Heavy Kettlebell Swings", prescription: "30 reps for time" },
    { name: "Dumbbell Rows", prescription: "3 × 15 heavy reps" },
  ],
  SkiErg: [
    { name: "Assault Bike", prescription: "50 cal for time" },
    { name: "Burpees", prescription: "30 reps for time" },
  ],
  Rowing: [
    { name: "Assault Bike", prescription: "50 cal for time" },
    { name: "SkiErg", prescription: "1,000m for time" },
  ],
  "Burpee Broad Jumps": [
    { name: "Box Jump Overs", prescription: "30 reps for time" },
    { name: "Burpees", prescription: "25 reps for time" },
  ],
  "Farmers Carry": [
    { name: "Heavy Dumbbell Carry", prescription: "200m for time" },
    { name: "Kettlebell Carry", prescription: "200m for time" },
  ],
  "Sandbag Lunges": [
    { name: "Front Rack Dumbbell Lunges", prescription: "100m for time" },
    { name: "Goblet Walking Lunges", prescription: "100m for time" },
  ],
  "Wall Balls": [
    { name: "Thrusters", prescription: "50 reps for time" },
    { name: "Dumbbell Thrusters", prescription: "50 reps for time" },
  ],
};
