/** Shared types for the practice race timer feature */

export interface RaceSegment {
  id: string;
  segmentType: "run" | "station";
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
  label: string;
  timeMs: number;
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
