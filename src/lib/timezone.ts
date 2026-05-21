// ---------------------------------------------------------------------------
// Gym time-zone handling.
//
// `communities.gym_timezone` is NOT NULL with a default, but the branding API
// historically accepted any string for it. A gym can therefore carry an empty
// or malformed value. Passing such a value to `Intl.DateTimeFormat` throws
// `RangeError: Invalid time zone specified`, which crashes server-rendered
// pages (e.g. /gym/programming) with an opaque "A server error occurred".
//
// Resolve every read of a gym's time zone through `resolveGymTimezone()` and
// reject bad values on write with `isValidTimeZone()`.
// ---------------------------------------------------------------------------

/** App-wide default when a gym has no usable time zone. */
export const DEFAULT_GYM_TIMEZONE = "America/Denver";

/** True if `tz` is a valid IANA time zone accepted by `Intl`. */
export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    // Constructing the formatter is what validates the zone — an unknown or
    // malformed zone throws a RangeError here.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns `raw` when it is a valid IANA zone, otherwise the app default.
 * Use this at every site that reads `communities.gymTimezone` before the
 * value reaches `Intl.DateTimeFormat` or any date helper built on it.
 */
export function resolveGymTimezone(raw: string | null | undefined): string {
  return isValidTimeZone(raw) ? raw : DEFAULT_GYM_TIMEZONE;
}
