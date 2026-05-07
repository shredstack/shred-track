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
  /** e.g. "1000m", "50m" */
  distance?: string;
  /** e.g. 100 for wall balls */
  reps?: number;
  /** Display-only weight context from division, e.g. "2×16 kg" */
  weightLabel?: string;
}

export interface CompletedSegment {
  segmentOrder: number;
  segmentType: "run" | "station";
  segmentSubtype?: SegmentSubtype | null;
  label: string;
  timeMs: number;
  /** Measured distance for run segments on iOS (HealthKit). Null on web / stations. */
  distanceMeters?: number | null;
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
