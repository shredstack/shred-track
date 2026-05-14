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

/** Which device originally started the current race. Determines save
 *  authority: at finish, only the origin device writes/enqueues the
 *  race. The other device transitions to a passive "view results"
 *  screen so the same race never lands in the DB twice. */
export type RaceSource = "phone" | "watch";

export interface TimerState {
  status: TimerStatus;
  /** Stable identifier minted at race-start time on the originating
   *  device. Used to dedupe sync events arriving from the paired
   *  device so a late `race.split` from the watch can't be applied to
   *  a stale race after the user has already started a new one. */
  raceId: string | null;
  /** Which device started this race. Null when idle. */
  source: RaceSource | null;
  raceStartedAt: number | null;
  segmentStartedAt: number | null;
  /** UTC ms when the running clock should begin. While `status === "countdown"`
   *  this is in the future; once the countdown fires it becomes equal
   *  to `raceStartedAt` and the clock starts ticking. */
  countdownEndsAt: number | null;
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
