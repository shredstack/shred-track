// ---------------------------------------------------------------------------
// Race-date handling for the free plan flow.
//
// The 18-week template is anchored to a race-day Saturday. We have four
// cases to handle:
//
//   1. No race date (null)         → start on the Monday after today,
//                                     race day is the Saturday of week 18.
//   2. Race >18 weeks out          → start on the Monday that's 18 weeks
//                                     before the race Saturday.
//   3. Race 14–17 weeks out        → compress by skipping early template
//                                     weeks (start_template_week = 19 - weeks).
//   4. Race <14 weeks out          → not supported; surface the paywall.
//
// All dates are ISO "YYYY-MM-DD" strings. Math is done in UTC to avoid TZ
// drift — since we're only working with dates, not times, UTC is correct.
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

export interface PlanDateResolution {
  /** Where we start copying from the template (1 = beginning; 4 = skip Phase 1). */
  startTemplateWeek: number;
  /** How many weeks the user's plan runs. 18 minus skipped weeks. */
  totalWeeks: number;
  /** ISO date the plan starts (Monday). */
  startDate: string;
  /** ISO date of race Saturday. */
  endDate: string;
}

export type RaceDateProblem =
  | { kind: "race_too_soon"; weeksUntilRace: number };

export type PlanDateResult =
  | { ok: true; resolution: PlanDateResolution }
  | { ok: false; problem: RaceDateProblem };

/**
 * Resolve a user's selected race date into the plan's start date,
 * start_template_week, and totalWeeks.
 *
 * @param raceDateIso   ISO "YYYY-MM-DD" of the user's target race Saturday,
 *                      or null if they chose "start today".
 * @param todayIso      ISO "YYYY-MM-DD" of "today" (injectable for tests).
 */
export function resolvePlanDates(
  raceDateIso: string | null,
  todayIso: string = isoToday(),
): PlanDateResult {
  const today = parseISODate(todayIso);

  if (raceDateIso === null) {
    // No race date — start on the next Monday, run 18 weeks, race = Saturday of week 18.
    const start = nextMonday(today);
    const end = addDays(start, 18 * 7 - 2); // Monday + 17 weeks + 5 days = Saturday of week 18
    return {
      ok: true,
      resolution: {
        startTemplateWeek: 1,
        totalWeeks: 18,
        startDate: formatISO(start),
        endDate: formatISO(end),
      },
    };
  }

  const raceSaturday = parseISODate(raceDateIso);
  const daysUntilRace = Math.round((raceSaturday.getTime() - today.getTime()) / MS_PER_DAY);
  const weeksUntilRace = Math.floor(daysUntilRace / 7);

  if (weeksUntilRace < 14) {
    return { ok: false, problem: { kind: "race_too_soon", weeksUntilRace } };
  }

  if (weeksUntilRace >= 18) {
    // Plan starts on the Monday that's 18 weeks before race day.
    // Use the Monday of that ISO week so start always lands on Monday.
    const start = addDays(raceSaturday, -(18 * 7 - 2)); // race Sat - 17 weeks + back to Monday
    return {
      ok: true,
      resolution: {
        startTemplateWeek: 1,
        totalWeeks: 18,
        startDate: formatISO(start),
        endDate: raceDateIso,
      },
    };
  }

  // 14 ≤ weeksUntilRace ≤ 17 → compress
  const startTemplateWeek = 19 - weeksUntilRace; // 17→2, 16→3, 15→4, 14→5
  const totalWeeks = weeksUntilRace;
  const start = addDays(raceSaturday, -(totalWeeks * 7 - 2));
  return {
    ok: true,
    resolution: {
      startTemplateWeek,
      totalWeeks,
      startDate: formatISO(start),
      endDate: raceDateIso,
    },
  };
}

// ---------------------------------------------------------------------------
// Small ISO date helpers (native Date, UTC-only)
// ---------------------------------------------------------------------------

export function isoToday(): string {
  return formatISO(new Date());
}

export function parseISODate(iso: string): Date {
  // Force UTC interpretation — "YYYY-MM-DD" parsed by `new Date()` in Node is
  // already UTC midnight, but some callers may pass shapes we don't control.
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatISO(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** Next Monday after `date`. If today is already Monday, returns next Monday (not today). */
export function nextMonday(date: Date): Date {
  const day = date.getUTCDay(); // 0=Sun..6=Sat
  // Days to next Monday (Mon=1). If today is Monday, return next Monday.
  const add = ((1 - day + 7) % 7) || 7;
  return addDays(date, add);
}

/** Compute weeks between two ISO dates (a - b, in whole weeks, can be negative). */
export function weeksBetween(aIso: string, bIso: string): number {
  const a = parseISODate(aIso);
  const b = parseISODate(bIso);
  return Math.round((a.getTime() - b.getTime()) / MS_PER_WEEK);
}
