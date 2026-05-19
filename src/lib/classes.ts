// Class schedule helpers (spec §2.2).

import { RRule } from "rrule";

function addMinutes(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 60_000);
}

export interface SlotExpansion {
  startAt: Date;
  endAt: Date;
}

/**
 * Expand a slot's RRULE within [windowStart, windowEnd) using the gym's
 * timezone. The slot stores rrule + start_time (local). For each rrule
 * occurrence we attach the local start_time and resolve to a UTC instant.
 */
export function expandSlotOccurrences(opts: {
  rrule: string;
  startTime: string; // HH:MM:SS or HH:MM
  durationMin: number;
  activeFrom: Date;
  activeTo: Date | null;
  gymTimezone: string;
  windowStart: Date;
  windowEnd: Date;
}): SlotExpansion[] {
  const lower = max(opts.activeFrom, opts.windowStart);
  const upper = opts.activeTo
    ? min(addDays(opts.activeTo, 1), opts.windowEnd)
    : opts.windowEnd;
  if (upper <= lower) return [];

  // RRule operates on naive dates. We anchor with DTSTART derived from
  // activeFrom + startTime to keep BYHOUR/BYMINUTE meaningful.
  const [hh, mm, ss] = opts.startTime.split(":").map((s) => Number(s) || 0);
  const dtStart = new Date(
    Date.UTC(
      opts.activeFrom.getUTCFullYear(),
      opts.activeFrom.getUTCMonth(),
      opts.activeFrom.getUTCDate(),
      hh,
      mm,
      ss
    )
  );
  let rule: RRule;
  try {
    rule = RRule.fromString(`DTSTART:${toRruleStamp(dtStart)}\n${opts.rrule.startsWith("RRULE:") ? opts.rrule : `RRULE:${opts.rrule}`}`);
  } catch {
    return [];
  }
  const occurrences = rule.between(lower, upper, true);
  const out: SlotExpansion[] = [];
  for (const occ of occurrences) {
    // `occ` is in UTC-naive form per rrule semantics. Treat the
    // year/month/day as gym-local, apply the gym tz offset to get a real UTC
    // instant.
    const localISO = `${occ.getUTCFullYear()}-${pad(occ.getUTCMonth() + 1)}-${pad(
      occ.getUTCDate()
    )}T${pad(hh)}:${pad(mm)}:${pad(ss)}`;
    const startUtc = gymLocalToUtc(localISO, opts.gymTimezone);
    out.push({
      startAt: startUtc,
      endAt: addMinutes(startUtc, opts.durationMin),
    });
  }
  return out;
}

function toRruleStamp(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function max(a: Date, b: Date): Date {
  return a > b ? a : b;
}
function min(a: Date, b: Date): Date {
  return a < b ? a : b;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

/**
 * Treat a wall-clock string in the gym's timezone as a real instant by
 * computing the timezone's UTC offset at that wall clock.
 */
export function gymLocalToUtc(localIso: string, tz: string): Date {
  // Build a fake "UTC" date that has the local clock values.
  const fake = new Date(localIso + "Z");
  // Compute what that wall clock would render as if interpreted in tz.
  const offset = tzOffsetAt(tz, fake);
  return new Date(fake.getTime() - offset);
}

function tzOffsetAt(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const localUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return localUtc - at.getTime();
}
