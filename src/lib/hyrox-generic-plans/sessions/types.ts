// ---------------------------------------------------------------------------
// Shared types for session renderers.
// ---------------------------------------------------------------------------

import type { SessionDetail, PaceSpec } from "@/types/hyrox-plan";
import type { StationName } from "@/lib/hyrox-data";
import type {
  Gender,
  RaceFormat,
  PaceTier,
  WeightTier,
  StationTargets,
} from "../calibration";
import type { GenericPhase } from "../phases";
import type { WeeklyRotation } from "../rotations";

export interface RenderContext {
  gender: Gender;
  raceFormat: RaceFormat;
  paceTier: PaceTier;
  weightTier: WeightTier;
  week: number;
  phase: GenericPhase;
  rotation: WeeklyRotation;
  stationTargets: StationTargets;
  /** Race-order reps/weights for this gender+weightTier, pulled from DIVISIONS. */
  stationSpecs: Record<StationName, RenderStationSpec>;
}

/** Flattened station spec the renderer needs. */
export interface RenderStationSpec {
  name: StationName;
  distanceMeters?: number;
  reps?: number;
  weightKg?: number;
  /** For Farmers Carry: per-hand weight (used to render "2×16 kg"). */
  weightKgPerHand?: number;
  hands?: number;
  /** Render hint: true if this station is machine-paced (SkiErg/Rowing). */
  isMachinePaced: boolean;
}

export type SessionTypeKey = "station_skills" | "run" | "hyrox_day" | "rest";

/** What a session renderer returns — one row in hyrox_generic_plan_template_sessions. */
export interface RenderedSession {
  dayOfWeek: number; // 0..6 (Mon..Sun)
  orderInDay: number;
  sessionType: SessionTypeKey;
  title: string;
  description: string;
  paceSpec: PaceSpec | null;
  durationMinutes: number | null;
  sessionDetail: SessionDetail;
  equipmentRequired: string[];
}
