// /gym/programming
//
// Lands the coach on the upcoming Monday of their gym-local timezone.
// Server-redirects to /gym/programming/<weekStart>. The detailed week
// editor lives at the child route.

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { communities, users } from "@/db/schema";
import { getSessionUser } from "@/lib/session";

function mondayOfThisWeekInTz(tz: string): string {
  // Pull today's date in the gym tz, then walk back to Monday.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = fmt.formatToParts(new Date());
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "";
  const y = get("year");
  const m = get("month");
  const d = get("day");
  const weekday = get("weekday"); // e.g. 'Mon'
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    weekday
  );
  // Walk back to Monday (Mon=1; offset = weekdayIndex - 1, with Sun → -1 → +6).
  const offset = (weekdayIndex - 1 + 7) % 7;
  const today = new Date(`${y}-${m}-${d}T00:00:00Z`);
  today.setUTCDate(today.getUTCDate() - offset);
  return today.toISOString().slice(0, 10);
}

export default async function ProgrammingIndexPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [row] = await db
    .select({ activeCommunityId: users.activeCommunityId })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!row?.activeCommunityId) redirect("/");

  const [gym] = await db
    .select({ gymTimezone: communities.gymTimezone })
    .from(communities)
    .where(eq(communities.id, row.activeCommunityId))
    .limit(1);

  const tz = gym?.gymTimezone ?? "America/Denver";
  const weekStart = mondayOfThisWeekInTz(tz);
  redirect(`/gym/programming/${weekStart}`);
}
