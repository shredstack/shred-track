// Monthly Challenge Builder (spec §3.1 / §5.1).
//
// Pure, isomorphic. The admin Builder UI imports this for the live
// preview; the seed-from-builder route imports it to compute the rows to
// upsert via `bulkUpsertTrackDays`. Single source of truth keeps preview
// + persisted output in lockstep — same contract as
// `generate-progression`.

import type {
  TrackBuilderPattern,
  TrackBuilderRestCadence,
} from "@/types/programming-tracks";

export interface BuilderInput {
  startsOn: string; // YYYY-MM-DD
  endsOn: string; // YYYY-MM-DD inclusive
  /** Display label for the metric — "Burpees", "Veggies (g)". */
  label: string;
  pattern: BuilderPattern;
  restCadence: TrackBuilderRestCadence;
  restDayLabel?: string;
}

export type BuilderPattern =
  | { kind: "flat"; dailyAmount: number }
  | {
      kind: "ladder";
      startAmount: number;
      incrementPerDay: number;
      weeklyBonus?: number;
    }
  | {
      kind: "per_day";
      daysSets: Array<{ date: string; sets: number[]; restHint?: string }>;
    };

export interface BuilderDayOutput {
  date: string;
  body: string;
  isRestDay: boolean;
  isScored: boolean;
  /** Numeric prescribed amount — null on rest days. */
  prescribedValue: number | null;
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function diffDaysInclusive(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

function isRestDay(
  cadence: TrackBuilderRestCadence,
  calendarDayOneBased: number,
  dayOfWeek: number
): boolean {
  switch (cadence) {
    case "none":
      return false;
    case "every_7th":
      return calendarDayOneBased % 7 === 0;
    case "weekends":
      // Sun = 0, Sat = 6 in UTC.
      return dayOfWeek === 0 || dayOfWeek === 6;
  }
}

/**
 * Generate one row per date in `[startsOn, endsOn]` (inclusive). Rest
 * days emit a rest row; non-rest days compute body + prescribedValue per
 * the chosen pattern.
 *
 * Throws on invalid input — the route layer catches and returns 400.
 */
export function generateBuilderDays(input: BuilderInput): BuilderDayOutput[] {
  if (!isIsoDate(input.startsOn) || !isIsoDate(input.endsOn)) {
    throw new Error("startsOn / endsOn must be YYYY-MM-DD");
  }
  if (!input.label.trim()) {
    throw new Error("label is required");
  }
  const start = parseUtcDate(input.startsOn);
  const end = parseUtcDate(input.endsOn);
  if (end.getTime() < start.getTime()) {
    throw new Error("endsOn must be on or after startsOn");
  }
  const total = diffDaysInclusive(start, end);
  const restLabel = input.restDayLabel?.trim() || "Rest day";
  const label = input.label.trim();

  // Pre-flight the pattern-specific config.
  if (input.pattern.kind === "flat") {
    if (
      !Number.isFinite(input.pattern.dailyAmount) ||
      input.pattern.dailyAmount < 0
    ) {
      throw new Error("flat.dailyAmount must be a non-negative number");
    }
  } else if (input.pattern.kind === "ladder") {
    if (
      !Number.isFinite(input.pattern.startAmount) ||
      input.pattern.startAmount < 0
    ) {
      throw new Error("ladder.startAmount must be a non-negative number");
    }
    if (
      !Number.isFinite(input.pattern.incrementPerDay) ||
      input.pattern.incrementPerDay < 0
    ) {
      throw new Error("ladder.incrementPerDay must be a non-negative number");
    }
    if (
      input.pattern.weeklyBonus != null &&
      (!Number.isFinite(input.pattern.weeklyBonus) ||
        input.pattern.weeklyBonus < 0)
    ) {
      throw new Error("ladder.weeklyBonus must be a non-negative number");
    }
  } else if (input.pattern.kind === "per_day") {
    if (!Array.isArray(input.pattern.daysSets)) {
      throw new Error("per_day.daysSets must be an array");
    }
    for (const row of input.pattern.daysSets) {
      if (!isIsoDate(row.date)) {
        throw new Error(`per_day.daysSets[${row.date}] date is invalid`);
      }
      if (!Array.isArray(row.sets) || row.sets.some((s) => !(s >= 0))) {
        throw new Error(
          `per_day.daysSets[${row.date}] sets must be non-negative numbers`
        );
      }
    }
  }

  const perDayMap =
    input.pattern.kind === "per_day"
      ? new Map(input.pattern.daysSets.map((d) => [d.date, d]))
      : null;

  const out: BuilderDayOutput[] = [];
  let workingDayIndex = 0;
  for (let i = 0; i < total; i++) {
    const day = new Date(start.getTime() + i * 86_400_000);
    const date = toIso(day);
    const dow = day.getUTCDay();
    const calendarDayOneBased = i + 1;
    const rest = isRestDay(input.restCadence, calendarDayOneBased, dow);

    if (rest) {
      out.push({
        date,
        body: restLabel,
        isRestDay: true,
        isScored: false,
        prescribedValue: null,
      });
      continue;
    }

    if (input.pattern.kind === "flat") {
      const v = input.pattern.dailyAmount;
      out.push({
        date,
        body: `${v} ${label}`,
        isRestDay: false,
        isScored: true,
        prescribedValue: v,
      });
    } else if (input.pattern.kind === "ladder") {
      const weeklyBonus = input.pattern.weeklyBonus ?? 0;
      const v =
        input.pattern.startAmount +
        input.pattern.incrementPerDay * workingDayIndex +
        weeklyBonus * Math.floor(workingDayIndex / 7);
      out.push({
        date,
        body: `${v} ${label}`,
        isRestDay: false,
        isScored: true,
        prescribedValue: v,
      });
    } else {
      const row = perDayMap?.get(date);
      if (!row || row.sets.length === 0) {
        // Day not specified in the per-day editor — emit an empty row so
        // the admin sees they have unfilled days, but mark unscored so
        // members aren't asked to log nothing.
        out.push({
          date,
          body: `Add sets for ${date}`,
          isRestDay: false,
          isScored: false,
          prescribedValue: null,
        });
      } else {
        const sum = row.sets.reduce((acc, s) => acc + s, 0);
        const setsText = row.sets.join(" / ");
        const restHint = row.restHint?.trim();
        const body = restHint
          ? `${setsText} ${label}, ${restHint}`
          : `${setsText} ${label}`;
        out.push({
          date,
          body,
          isRestDay: false,
          isScored: true,
          prescribedValue: sum,
        });
      }
    }

    workingDayIndex += 1;
  }

  return out;
}

/**
 * Parse a body line written by `generateBuilderDays` with a `per_day`
 * pattern back into sets. Returns `null` if the body doesn't match the
 * sets shape, so the athlete-side TrackDayChallengeInput can fall back to
 * single-value mode.
 *
 * Expected shape: `"6 / 4 / 3 / 3 Burpees, rest :20"`, where the
 * sets are slash-separated numbers (positive integers).
 *
 * Why parse instead of round-tripping through `trackDayScores.textValue`?
 * Because the *prescription* is what the per-day tile UI keys off — the
 * tiles correspond to the prescribed sets, not the athlete's prior
 * completion state. The athlete's completion state lives in textValue.
 */
export function parseSetsFromBody(
  body: string | null | undefined
): { sets: number[]; label: string; restHint?: string } | null {
  if (!body) return null;
  const trimmed = body.trim();
  // Split off rest hint after the last comma.
  let main = trimmed;
  let restHint: string | undefined;
  const lastComma = trimmed.lastIndexOf(",");
  if (lastComma >= 0) {
    main = trimmed.slice(0, lastComma).trim();
    restHint = trimmed.slice(lastComma + 1).trim() || undefined;
  }

  // main is "6 / 4 / 3 / 3 Burpees" — split on first non-{digit, /, ws}.
  const match = main.match(/^([\d\s/]+)\s+(.+)$/);
  if (!match) return null;
  const numbersPart = match[1].trim();
  const label = match[2].trim();
  // Must look like slash-separated numbers — bail otherwise.
  if (!/^\s*\d+(\s*\/\s*\d+)+\s*$/.test(numbersPart)) return null;
  const sets = numbersPart
    .split("/")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (sets.length < 2) return null;
  return { sets, label, restHint };
}

/**
 * Round-trip helper for callers (route + UI) that need a serialized
 * pattern descriptor. Mirrors the JSONB shape stored in scoringConfig.
 */
export function patternToBuilderPattern(
  pattern: BuilderPattern
): TrackBuilderPattern {
  if (pattern.kind === "flat") {
    return { kind: "flat", dailyAmount: pattern.dailyAmount };
  }
  if (pattern.kind === "ladder") {
    return {
      kind: "ladder",
      startAmount: pattern.startAmount,
      incrementPerDay: pattern.incrementPerDay,
      weeklyBonus: pattern.weeklyBonus ?? 0,
    };
  }
  return { kind: "per_day" };
}
