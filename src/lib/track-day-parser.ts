// Track-day parser (spec §2.4). Splits a multi-day track prescription
// into one body per day.
//
// Accepts paste-style text like:
//   Day 1: 25 push-ups
//   Day 2: 30 push-ups
//   Day 3 - 35 push-ups
// And returns [{ dayNumber, body }, ...] sorted by dayNumber.

const DAY_HEADER_RE = /^\s*Day\s*(\d+)\s*[:.\-–—]\s*(.*)$/i;

export interface ParsedTrackDay {
  dayNumber: number;
  body: string;
}

export function parseTrackDays(text: string): ParsedTrackDay[] {
  const lines = text.split(/\r?\n/);
  const days = new Map<number, string[]>();
  let current: number | null = null;
  for (const line of lines) {
    const m = DAY_HEADER_RE.exec(line);
    if (m) {
      current = Number(m[1]);
      const rest = m[2].trim();
      const list = days.get(current) ?? [];
      if (rest) list.push(rest);
      days.set(current, list);
    } else if (current !== null) {
      if (line.trim()) {
        const list = days.get(current) ?? [];
        list.push(line.trim());
        days.set(current, list);
      }
    }
  }
  return [...days.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([dayNumber, parts]) => ({
      dayNumber,
      body: parts.join(" ").trim(),
    }));
}

/** Convert a parsed result to date-keyed days based on a track's start date. */
export function attachDates(
  parsed: ParsedTrackDay[],
  startIso: string
): Array<{ date: string; body: string; dayNumber: number }> {
  const start = new Date(`${startIso}T00:00:00Z`);
  return parsed.map((p) => {
    const d = new Date(start.getTime() + (p.dayNumber - 1) * 86_400_000);
    return {
      date: d.toISOString().slice(0, 10),
      body: p.body,
      dayNumber: p.dayNumber,
    };
  });
}
