// ---------------------------------------------------------------------------
// CAP paste parser.
//
// Coaches paste a raw week of CAP-style programming text. We split it on
// day headers, then per-day split on section heading keywords. Sections
// that don't match a known kind fall back to `custom` and the coach edits
// inline.
//
// This is intentionally heuristic — CAP doesn't expose an API and free-form
// text varies. The goal is "good enough that 80% of paste-and-save works,"
// not 100% parsing fidelity.
// ---------------------------------------------------------------------------

import type {
  WorkoutSectionKind,
  WorkoutSectionScoreType,
} from "@/db/schema";

export interface ParsedSection {
  kind: WorkoutSectionKind;
  title: string | null;
  body: string;
  isScored: boolean;
  scoreType: WorkoutSectionScoreType | null;
}

export interface ParsedDay {
  // 0 = Monday … 6 = Sunday, relative to the week_start the coach picked.
  dayIndex: number;
  // Human-readable day label as it appeared in the source text (e.g. "MON 5/19").
  headerText: string | null;
  sections: ParsedSection[];
}

export interface ParsedWeek {
  days: ParsedDay[];
}

const DAY_NAMES = [
  ["mon", "monday"],
  ["tue", "tues", "tuesday"],
  ["wed", "weds", "wednesday"],
  ["thu", "thur", "thurs", "thursday"],
  ["fri", "friday"],
  ["sat", "saturday"],
  ["sun", "sunday"],
];

const DAY_NAME_TO_INDEX = new Map<string, number>(
  DAY_NAMES.flatMap((aliases, i) => aliases.map((a) => [a, i] as [string, number]))
);

// Section heading detection. Order matters — more specific patterns first.
interface SectionMatcher {
  re: RegExp;
  kind: WorkoutSectionKind;
  scored: boolean;
  scoreType: WorkoutSectionScoreType | null;
}

const SECTION_MATCHERS: SectionMatcher[] = [
  // Warm-up / Cool-down variants.
  { re: /^warm[\s-]*up\b.*/i, kind: "warm_up", scored: false, scoreType: null },
  { re: /^primer\b.*/i, kind: "warm_up", scored: false, scoreType: null },
  { re: /^cool[\s-]*down\b.*/i, kind: "stretching", scored: false, scoreType: null },
  { re: /^stretch(ing)?\b.*/i, kind: "stretching", scored: false, scoreType: null },
  // Skill / strength — usually pre-WOD; we tag them pre_skill.
  { re: /^skill\b.*/i, kind: "pre_skill", scored: false, scoreType: null },
  { re: /^strength\b.*/i, kind: "pre_skill", scored: true, scoreType: "weight" },
  // The WOD itself.
  { re: /^wod\b.*/i, kind: "wod", scored: true, scoreType: "time" },
  { re: /^metcon\b.*/i, kind: "wod", scored: true, scoreType: "time" },
  { re: /^workout\b.*/i, kind: "wod", scored: true, scoreType: "time" },
  // Accessory / post-skill / finisher.
  { re: /^accessory\b.*/i, kind: "post_skill", scored: false, scoreType: null },
  { re: /^finisher\b.*/i, kind: "post_skill", scored: false, scoreType: null },
  // Optional at-home work.
  { re: /^at[\s-]*home\b.*/i, kind: "at_home", scored: false, scoreType: null },
];

function matchSectionHeading(line: string): SectionMatcher | null {
  // Strip a trailing colon, common in headings like "WOD:" or "Warm-up:".
  const cleaned = line.trim().replace(/[:\-—]\s*$/, "").trim();
  for (const m of SECTION_MATCHERS) {
    if (m.re.test(cleaned)) return m;
  }
  return null;
}

// Day header detection. Matches lines like:
//   MONDAY
//   Mon 5/19
//   Mon, May 19
//   Day 1
const DAY_HEADER_RE =
  /^\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun|day\s+\d+)\b/i;

function parseDayHeader(line: string): { dayIndex: number | null; text: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const m = trimmed.match(DAY_HEADER_RE);
  if (!m) return null;
  const token = m[1].toLowerCase().replace(/\s+/g, " ").trim();

  if (token.startsWith("day")) {
    const num = Number(token.slice(4));
    if (Number.isFinite(num) && num >= 1 && num <= 7) {
      return { dayIndex: num - 1, text: trimmed };
    }
    return { dayIndex: null, text: trimmed };
  }

  const idx = DAY_NAME_TO_INDEX.get(token);
  return { dayIndex: idx ?? null, text: trimmed };
}

/**
 * Parse CAP paste text into a structured 7-day week. Day headers we
 * couldn't classify are dropped; sections without a recognized heading
 * are emitted as `kind: 'custom'` so the coach can fix them in-place.
 */
export function parseCapPaste(input: string): ParsedWeek {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const days: ParsedDay[] = [];
  let currentDay: ParsedDay | null = null;
  let currentSection: ParsedSection | null = null;
  const usedDayIndices = new Set<number>();

  function flushSection() {
    if (currentDay && currentSection) {
      currentSection.body = currentSection.body.trim();
      if (currentSection.body || currentSection.title) {
        currentDay.sections.push(currentSection);
      }
    }
    currentSection = null;
  }

  function flushDay() {
    flushSection();
    if (currentDay && currentDay.sections.length > 0) {
      days.push(currentDay);
    }
    currentDay = null;
  }

  function nextFreeDayIndex(): number {
    for (let i = 0; i < 7; i++) {
      if (!usedDayIndices.has(i)) return i;
    }
    return 0; // overflow — shouldn't happen with a sensible paste
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/^﻿/, ""); // strip BOM if present

    const dayHeader = parseDayHeader(line);
    if (dayHeader) {
      flushDay();
      const dayIndex = dayHeader.dayIndex ?? nextFreeDayIndex();
      usedDayIndices.add(dayIndex);
      currentDay = {
        dayIndex,
        headerText: dayHeader.text,
        sections: [],
      };
      continue;
    }

    if (!currentDay) continue; // skip preamble before the first day header

    const sectionHeading = matchSectionHeading(line);
    if (sectionHeading) {
      flushSection();
      currentSection = {
        kind: sectionHeading.kind,
        title: line.trim() || null,
        body: "",
        isScored: sectionHeading.scored,
        scoreType: sectionHeading.scoreType,
      };
      continue;
    }

    // Body lines accumulate into the current section. If we don't have one
    // yet, open a `custom` section so we don't drop the content.
    if (!currentSection) {
      currentSection = {
        kind: "custom",
        title: null,
        body: "",
        isScored: false,
        scoreType: null,
      };
    }
    currentSection.body += rawLine + "\n";
  }

  flushDay();

  // Sort days by index so the UI renders Mon → Sun even if the paste was
  // out of order.
  days.sort((a, b) => a.dayIndex - b.dayIndex);
  return { days };
}
