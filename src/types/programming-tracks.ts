// Shared types for the Custom Tracks v2 surface area (spec §4.2).

export const TRACK_SCORING_UNITS = [
  "reps",
  "steps",
  "minutes",
  "meters",
  "kilometers",
  "kilograms",
  "pounds",
  "grams",
  "calories",
  "count",
  "percentage",
  "custom",
] as const;

export type TrackScoringUnit = (typeof TRACK_SCORING_UNITS)[number];

export const TRACK_SCORING_AGGREGATIONS = [
  "sum",
  "last",
  "per_day_independent",
  "streak",
] as const;

export type TrackScoringAggregation =
  (typeof TRACK_SCORING_AGGREGATIONS)[number];

/**
 * Builder-emitted pattern metadata. Stored so "Re-run Builder" knows what
 * to re-render. Authoring-side only — athlete-facing code never reads it.
 */
export type TrackBuilderPattern =
  | { kind: "flat"; dailyAmount: number }
  | {
      kind: "ladder";
      startAmount: number;
      incrementPerDay: number;
      weeklyBonus: number;
    }
  | { kind: "per_day" };

export const TRACK_BUILDER_REST_CADENCES = [
  "none",
  "every_7th",
  "weekends",
] as const;

export type TrackBuilderRestCadence =
  (typeof TRACK_BUILDER_REST_CADENCES)[number];

export const TRACK_BUILDER_MARK_DONE_STYLES = [
  "prefilled",
  "free_entry",
  "checkbox",
] as const;

export type TrackBuilderMarkDoneStyle =
  (typeof TRACK_BUILDER_MARK_DONE_STYLES)[number];

export interface TrackScoringConfig {
  unit: TrackScoringUnit;
  /** Required iff `unit === 'custom'`. e.g. "g of fruits/veg". */
  unitLabel?: string;
  /** Optional daily target — used for progress bars. */
  dailyTarget?: number;
  aggregation: TrackScoringAggregation;
  /** If true, the athlete can tap "Done" without entering a number. */
  allowJustDone?: boolean;
  /** Shown next to the input. */
  description?: string;
  /** Builder-emitted pattern metadata. See `TrackBuilderPattern`. */
  builderPattern?: TrackBuilderPattern;
  /** Builder-set rest-day cadence so Re-run Builder reproduces the same
   *  skip days. Not used at athlete-render time. */
  restCadence?: TrackBuilderRestCadence;
  /** Body to write for rest days. Defaults to "Rest day". */
  restDayLabel?: string;
  /** When true, the per-day input suppresses the numeric field entirely —
   *  the athlete only sees a "Mark done" button. Implies `allowJustDone`. */
  checkboxOnly?: boolean;
}

export const INLINE_POSITIONS = [
  "top",
  "after_wod",
  "before_at_home",
  "end_of_day",
] as const;

export type InlinePosition = (typeof INLINE_POSITIONS)[number];

export const DISPLAY_MODES = [
  "inline",
  "standalone",
  "inline_and_standalone",
] as const;

export type DisplayMode = (typeof DISPLAY_MODES)[number];

export const TRACK_KINDS = [
  "cap",
  "monthly_challenge",
  "event_prep",
  "custom",
] as const;

export type TrackKind = (typeof TRACK_KINDS)[number];

export interface TrackDayUpsertInput {
  body?: string | null;
  // Unified-schema link. `workout_sessions.id`. The legacy day editor never
  // sends this; only the workout-creating endpoint sets it on behalf of
  // the coach after upserting a template + creating the session.
  workoutSessionId?: string | null;
  isScored?: boolean;
  scoreType?:
    | "time"
    | "rounds"
    | "reps"
    | "weight"
    | "no_score"
    | null;
}

export interface TrackDaySummary {
  id: string;
  trackId: string;
  date: string;
  body: string | null;
  workoutId: string | null;
  isScored: boolean;
  scoreType: string | null;
}

/**
 * Returns the human-readable unit suffix for a scoring config (e.g. "reps",
 * "kg", "g of fruits/veg"). For `unit==='custom'` returns `unitLabel`.
 */
export function trackScoringUnitLabel(config: TrackScoringConfig): string {
  if (config.unit === "custom") {
    return config.unitLabel?.trim() || "units";
  }
  switch (config.unit) {
    case "kilograms":
      return "kg";
    case "pounds":
      return "lb";
    case "kilometers":
      return "km";
    case "meters":
      return "m";
    case "minutes":
      return "min";
    case "grams":
      return "g";
    default:
      return config.unit;
  }
}
