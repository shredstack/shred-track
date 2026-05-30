// ============================================================
// Calorie estimator — input/output types.
// ============================================================
// Pure data shapes. The estimator never touches the DB directly; callers
// load rows via Drizzle and pass them in. That keeps the math testable in
// isolation and lets the same function service the score-save handler,
// the workout-creation handler, and the admin recompute job.

import type { RepSchemeParsed } from "@/lib/crossfit/rep-scheme-parser";

export type Confidence = "high" | "medium" | "low";
export type EstimateMethod =
  | "per_part"
  | "duration_aggregate"
  | "manual_override";

export interface CalorieMovement {
  id: string;
  canonicalName: string;
  metValue: number | null;
  metIsEstimated: boolean;
  repSecondsDefault: number | null;
  isPacedRun: boolean;
  isPacedErg: "row" | "ski" | null;
}

export interface CaloriePartMovement {
  movement: CalorieMovement;
  prescribedReps: string | null;
  repSchemeParsed: RepSchemeParsed | null;
  prescribedDistanceMeters: number | null;
  prescribedDurationSeconds: number | null;
  isSideCadence: boolean;
  /** Observed per-rep seconds for this user, when available. */
  userRepSecondsObserved: number | null;
  /** Optional 0–1 multiplier for athlete loading vs. their 1RM. */
  loadPct1rm: number | null;
}

export interface CaloriePartInput {
  id: string;
  workoutType: string; // matches workout_parts.workoutType
  timeCapSeconds: number | null;
  amrapDurationSeconds: number | null;
  emomIntervalSeconds: number | null;
  intervalWorkSeconds: number | null;
  intervalRestSeconds: number | null;
  intervalRounds: Array<{ work: number; rest: number }> | null;
  rounds: number | null;
  repScheme: string | null;
  repSchemeParsed: RepSchemeParsed | null;
  structure: string | null;
  isWarmup?: boolean;
  movements: CaloriePartMovement[];
}

export interface CalorieScoreContext {
  /** Score-side time fields used by the duration resolver. */
  timeSeconds: number | null;
  hitTimeCap: boolean;
  woreVest: boolean | null;
  vestWeightLb: number | null;
  rpe: number | null;
  startedAt: Date | null;
  endedAt: Date | null;
}

export interface CalorieEstimatorInput {
  parts: CaloriePartInput[];
  /** Athlete bodyweight in kg used for the formula. */
  bodyweightKg: number;
  /** True when we fell back to a population default. Demotes confidence. */
  isDefaultBodyweight: boolean;
  /** When the user logged a score for this estimate run. Null for template-level estimates. */
  scoreContext?: CalorieScoreContext | null;
  /** EPOC multiplier resolved upstream. 1.0 disables. */
  epocMultiplier: number;
  /**
   * True for the workout-template estimate at the 75 kg reference. The template
   * path never loads per-user paces, so the "missing user pace" demotion would
   * fire on every movement — meaningless quality signal at this level. Skip it.
   */
  isTemplateLevel?: boolean;
}

export interface PartEstimate {
  partId: string;
  kcalTotal: number;
  kcalActive: number;
  confidence: Confidence;
}

export interface CalorieEstimate {
  /** Sum of part-level active energy. UI surfaces a ±15% range around this. */
  active: number;
  /** Sum of part-level total energy (incl. BMR baseline). For analytics. */
  gross: number;
  activeWithEpoc: number;
  grossWithEpoc: number;
  low: number;
  high: number;
  confidence: Confidence;
  method: EstimateMethod;
  parts: PartEstimate[];
}
