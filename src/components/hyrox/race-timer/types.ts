/** Shared types for the practice race timer feature */

/**
 * Discriminator for run segments. NULL/undefined is treated as
 * "prescribed_run" semantically (matches all pre-Roxzone-feature races).
 * Stations always leave this unset.
 */
export type SegmentSubtype = "prescribed_run" | "roxzone";

export interface RaceSegment {
  id: string;
  segmentType: "run" | "station";
  segmentSubtype?: SegmentSubtype | null;
  label: string;
  /** Display string, e.g. "1000m" / "1 km" / "50m". Source of truth is `distanceMeters` */
  distance?: string;
  /** Numeric distance for the segment. Mirrors `distance` for display. */
  distanceMeters?: number;
  /** e.g. 100 for wall balls */
  reps?: number;
  /** Weight in kilograms for stations that use weighted equipment. */
  weightKg?: number;
  /** Display-only weight label, e.g. "2×16 kg" */
  weightLabel?: string;
}

export interface CompletedSegment {
  segmentOrder: number;
  segmentType: "run" | "station";
  segmentSubtype?: SegmentSubtype | null;
  label: string;
  timeMs: number;
  /** Measured (HealthKit) or prescribed distance in meters. Null on stations with no distance. */
  distanceMeters?: number | null;
  /** Prescribed reps for the station segment, if any. */
  reps?: number | null;
  /** Prescribed station weight in kilograms, if any. */
  weightKg?: number | null;
  /** Prescribed station weight display label, if any. */
  weightLabel?: string | null;
}

export type TimerStatus = "idle" | "countdown" | "running" | "paused" | "complete";

export interface TimerState {
  status: TimerStatus;
  raceStartedAt: number | null;
  segmentStartedAt: number | null;
  pausedAt: number | null;
  totalPausedMs: number;
  segments: RaceSegment[];
  completedSegments: CompletedSegment[];
  currentSegmentIndex: number;
}

export type RaceTemplate = "full" | "half" | "custom";

export interface PracticeRaceResult {
  totalTimeMs: number;
  startedAt: number;
  completedAt: number;
  segments: CompletedSegment[];
  template: RaceTemplate;
  divisionKey: string;
}
