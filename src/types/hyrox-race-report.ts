// Shared JSONB shapes for hyrox_race_reports.
// Used by the Drizzle schema (.$type<>()), the Inngest generator, and UI consumers.

export interface TimeLossEntry {
  station: string;
  secondsLost: number;
  percentile?: number;
  p25Time?: number;
}

export interface FocusEntry {
  focus: string;
  rationale: string;
  sessionsPerWeek: number;
  durationWeeks: number;
}
