// ============================================
// Duration parsing
// ============================================
//
// Free-text → seconds. Used wherever a coach types a duration into the
// builder (":30 L-sit", "1:00 work", "rest 2:00", "90s", "1.5min"). The
// builder calls this on blur; the API treats already-numeric values as
// seconds.
//
// Returns null when the input doesn't parse — callers should fall back to
// "no prescription" rather than guessing a value.

export function parseDurationToSeconds(
  input: string | number | null | undefined
): number | null {
  if (input == null) return null;
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) return null;
    return Math.round(input);
  }
  const raw = input.trim();
  if (!raw) return null;

  // m:ss or mm:ss (also handles ":30" → 30s by treating the empty
  // minutes part as zero).
  const colonMatch = raw.match(/^(\d*):(\d{1,2})$/);
  if (colonMatch) {
    const minutes = colonMatch[1] ? parseInt(colonMatch[1], 10) : 0;
    const seconds = parseInt(colonMatch[2], 10);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
    if (seconds < 0 || seconds > 59) return null;
    return minutes * 60 + seconds;
  }

  // "1m30s" / "1m" / "30s"
  const mixedMatch = raw.match(/^(?:(\d+(?:\.\d+)?)\s*m(?:in)?)?\s*(?:(\d+(?:\.\d+)?)\s*s(?:ec)?)?$/i);
  if (mixedMatch && (mixedMatch[1] || mixedMatch[2])) {
    const m = mixedMatch[1] ? parseFloat(mixedMatch[1]) : 0;
    const s = mixedMatch[2] ? parseFloat(mixedMatch[2]) : 0;
    const total = Math.round(m * 60 + s);
    if (!Number.isFinite(total) || total < 0) return null;
    return total;
  }

  // "1.5min" / "0.5 min"
  const minMatch = raw.match(/^(\d+(?:\.\d+)?)\s*min(?:s|ute|utes)?$/i);
  if (minMatch) {
    const val = parseFloat(minMatch[1]);
    if (!Number.isFinite(val) || val < 0) return null;
    return Math.round(val * 60);
  }

  // Bare number → seconds.
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n);
  }

  return null;
}

// "1:30" / ":30" — useful both as a display value and as the placeholder
// in score-entry.
export function formatSecondsAsClock(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
