// Monthly challenge progression generator (spec §2.2).
//
// Pure, isomorphic helper — no DB access. The admin UI imports this to
// render a live preview of the first N days, and the server route imports
// it to compute the rows to upsert. The single source of truth keeps
// preview and persisted output in lockstep.

export type RestCadence = "none" | "everyN" | "daysOfWeek";

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6; // Sunday=0

export interface ProgressionInput {
  startsOn: string; // YYYY-MM-DD
  endsOn: string; // YYYY-MM-DD inclusive
  movement: string;
  startReps: number;
  dailyIncrement: number;
  restCadence: RestCadence;
  restEveryN?: number;
  restDaysOfWeek?: DayOfWeek[];
  capReps?: number;
  scoreType: "reps" | "no_score";
  format?: string;
  restDayLabel?: string;
}

export interface ProgressionDayOutput {
  date: string;
  body: string;
  isRestDay: boolean;
  isScored: boolean;
  scoreType: string | null;
  /** 1-based count of working days produced so far (rest days don't bump). */
  workingDayIndex: number | null;
  /** Reps prescribed for the day. Null on rest days. */
  reps: number | null;
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

/**
 * Generate one row per date in `[startsOn, endsOn]` (inclusive).
 *
 * Rest day rule: when a rest cadence matches, the day emits a rest row
 * with `body = restDayLabel ?? "Rest Day!"`, `isScored=false`. Rest days
 * do NOT increment the working-day index — so `everyN=7` produces a rest
 * on every 7th *working* day, and the 8th calendar day continues the
 * progression as if the rest hadn't happened.
 *
 * Throws on invalid input.
 */
export function generateProgression(
  input: ProgressionInput
): ProgressionDayOutput[] {
  if (!isIsoDate(input.startsOn) || !isIsoDate(input.endsOn)) {
    throw new Error("startsOn / endsOn must be YYYY-MM-DD");
  }
  if (!Number.isFinite(input.startReps) || input.startReps < 1) {
    throw new Error("startReps must be >= 1");
  }
  if (!Number.isFinite(input.dailyIncrement) || input.dailyIncrement < 0) {
    throw new Error("dailyIncrement must be >= 0");
  }
  if (input.restCadence === "everyN") {
    if (
      !input.restEveryN ||
      input.restEveryN < 2 ||
      input.restEveryN > 14
    ) {
      throw new Error("restEveryN must be between 2 and 14");
    }
  }
  if (input.restCadence === "daysOfWeek") {
    if (
      !Array.isArray(input.restDaysOfWeek) ||
      input.restDaysOfWeek.length === 0
    ) {
      throw new Error("restDaysOfWeek must contain at least one day");
    }
  }
  if (input.capReps != null && input.capReps < 1) {
    throw new Error("capReps must be >= 1");
  }
  if (!input.movement.trim()) {
    throw new Error("movement is required");
  }

  const start = parseUtcDate(input.startsOn);
  const end = parseUtcDate(input.endsOn);
  if (end.getTime() < start.getTime()) {
    throw new Error("endsOn must be on or after startsOn");
  }

  const total = diffDaysInclusive(start, end);
  const restLabel = input.restDayLabel?.trim() || "Rest Day!";
  const restDow = new Set(input.restDaysOfWeek ?? []);

  const out: ProgressionDayOutput[] = [];
  let workingDayIndex = 0; // counts non-rest days emitted so far

  for (let i = 0; i < total; i++) {
    const day = new Date(start.getTime() + i * 86_400_000);
    const date = toIso(day);
    const dow = day.getUTCDay() as DayOfWeek;

    let isRest = false;
    if (input.restCadence === "everyN") {
      // Every Nth calendar day in the range is a rest day. Day 7 is rest
      // when restEveryN=7. Working-day index does not advance on rest
      // days, so the calendar Day 8 is working day 7 and resumes the
      // progression from where Day 6 left off + 1 increment.
      const calendarDayOneBased = i + 1;
      isRest = calendarDayOneBased % input.restEveryN! === 0;
    } else if (input.restCadence === "daysOfWeek") {
      isRest = restDow.has(dow);
    }

    if (isRest) {
      out.push({
        date,
        body: restLabel,
        isRestDay: true,
        isScored: false,
        scoreType: null,
        workingDayIndex: null,
        reps: null,
      });
      continue;
    }

    // Working day. Reps = startReps + (workingDayIndex * dailyIncrement),
    // optionally clamped at capReps.
    const rawReps =
      input.startReps + workingDayIndex * input.dailyIncrement;
    const reps =
      input.capReps != null ? Math.min(rawReps, input.capReps) : rawReps;
    const formatPrefix = input.format?.trim()
      ? `${input.format.trim()}: `
      : "";
    const body = `${formatPrefix}${reps} ${input.movement.trim()}`;
    out.push({
      date,
      body,
      isRestDay: false,
      isScored: input.scoreType !== "no_score",
      scoreType: input.scoreType === "no_score" ? null : input.scoreType,
      workingDayIndex: workingDayIndex + 1,
      reps,
    });
    workingDayIndex += 1;
  }

  return out;
}
