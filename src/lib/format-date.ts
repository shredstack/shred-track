// Format a YYYY-MM-DD `workout_date` column value as "Mon D, YYYY".
// Parses to local time (no UTC drift) so e.g. "2026-04-22" displays as
// Apr 22, 2026 regardless of the user's timezone.
export function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
