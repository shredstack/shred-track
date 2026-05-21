// Committed Club math (spec §2.5).
//
// "Computed not stored" for the live month — we count class_registrations
// with status='attended' for the user in the gym-local current month. The
// snapshot table is only consulted for historical leaderboards.

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  classRegistrations,
  classInstances,
  communities,
  committedClubSnapshots,
  users,
} from "@/db/schema";
import { resolveGymTimezone } from "@/lib/timezone";

export interface CommittedClubProgress {
  classesAttended: number;
  threshold: number;
  qualified: boolean;
  rank: number | null;
  yearMonth: string;
}

/**
 * Returns first and last instant of a gym-local month as JS Date objects
 * (UTC). For naive month boundaries we treat the month as the calendar
 * month at the gym's timezone — good enough for monthly rollups.
 */
export function gymMonthBounds(
  gymTimezone: string,
  reference: Date = new Date()
): { startUtc: Date; endUtc: Date; yearMonth: string } {
  // Render reference in gym-local to get year + month.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: gymTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(reference);
  const yyyy = parts.find((p) => p.type === "year")!.value;
  const mm = parts.find((p) => p.type === "month")!.value;

  // Build the local midnight of the 1st of the month and the next month.
  // We approximate by constructing a UTC date and then shifting by the
  // gym's UTC offset. Good enough for inclusion math.
  const start = new Date(`${yyyy}-${mm}-01T00:00:00Z`);
  const next = new Date(start);
  next.setUTCMonth(next.getUTCMonth() + 1);

  // Adjust by the gym's actual offset at the reference date.
  const offsetMs = gymOffsetMs(gymTimezone, start);
  return {
    startUtc: new Date(start.getTime() - offsetMs),
    endUtc: new Date(next.getTime() - offsetMs),
    yearMonth: `${yyyy}-${mm}`,
  };
}

function gymOffsetMs(tz: string, at: Date): number {
  // Compute the timezone's offset at `at` by formatting and reading back.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
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

/** Get the user's current-month Committed Club progress for a gym. */
export async function getCurrentMonthProgress(
  userId: string,
  communityId: string
): Promise<CommittedClubProgress> {
  const [gym] = await db
    .select({
      timezone: communities.gymTimezone,
      threshold: communities.committedClubThreshold,
    })
    .from(communities)
    .where(eq(communities.id, communityId))
    .limit(1);
  if (!gym) {
    return {
      classesAttended: 0,
      threshold: 15,
      qualified: false,
      rank: null,
      yearMonth: new Date().toISOString().slice(0, 7),
    };
  }

  const { startUtc, endUtc, yearMonth } = gymMonthBounds(
    resolveGymTimezone(gym.timezone)
  );
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(classRegistrations)
    .innerJoin(
      classInstances,
      eq(classInstances.id, classRegistrations.classInstanceId)
    )
    .where(
      and(
        eq(classRegistrations.userId, userId),
        eq(classRegistrations.status, "attended"),
        eq(classInstances.communityId, communityId),
        gte(classInstances.startAt, startUtc),
        lt(classInstances.startAt, endUtc),
      )
    );

  const n = row?.n ?? 0;
  return {
    classesAttended: n,
    threshold: gym.threshold,
    qualified: n >= gym.threshold,
    rank: null, // populated by leaderboard query in the widget UI
    yearMonth,
  };
}

export interface CommittedClubLeaderboardRow {
  userId: string;
  userName: string;
  userImage: string | null;
  classesAttended: number;
  rank: number;
  qualified: boolean;
}

/** Top N for a given gym + year-month. Reads the live data for current
 *  month, falls back to the snapshot for historical months. */
export async function getMonthlyLeaderboard(
  communityId: string,
  yearMonth: string,
  limit = 50
): Promise<CommittedClubLeaderboardRow[]> {
  const [gym] = await db
    .select({
      timezone: communities.gymTimezone,
      threshold: communities.committedClubThreshold,
    })
    .from(communities)
    .where(eq(communities.id, communityId))
    .limit(1);
  if (!gym) return [];

  const tz = resolveGymTimezone(gym.timezone);
  const currentMonth = gymMonthBounds(tz).yearMonth;

  if (yearMonth === currentMonth) {
    const { startUtc, endUtc } = gymMonthBounds(tz);
    const rows = await db
      .select({
        userId: classRegistrations.userId,
        userName: users.name,
        userImage: users.image,
        classesAttended: sql<number>`count(*)::int`,
      })
      .from(classRegistrations)
      .innerJoin(
        classInstances,
        eq(classInstances.id, classRegistrations.classInstanceId)
      )
      .innerJoin(users, eq(users.id, classRegistrations.userId))
      .where(
        and(
          eq(classRegistrations.status, "attended"),
          eq(classInstances.communityId, communityId),
          gte(classInstances.startAt, startUtc),
          lt(classInstances.startAt, endUtc),
          // Dependents spec §3.6: shadow users never appear on social
          // surfaces like the Committed Club leaderboard.
          eq(users.isShadow, false)
        )
      )
      .groupBy(classRegistrations.userId, users.name, users.image)
      .orderBy(sql`count(*) desc`)
      .limit(limit);

    return rows.map((r, i) => ({
      ...r,
      rank: i + 1,
      qualified: r.classesAttended >= gym.threshold,
    }));
  }

  const rows = await db
    .select({
      userId: committedClubSnapshots.userId,
      userName: users.name,
      userImage: users.image,
      classesAttended: committedClubSnapshots.classesAttended,
      rank: committedClubSnapshots.rank,
    })
    .from(committedClubSnapshots)
    .innerJoin(users, eq(users.id, committedClubSnapshots.userId))
    .where(
      and(
        eq(committedClubSnapshots.communityId, communityId),
        eq(committedClubSnapshots.yearMonth, yearMonth),
        // Dependents spec §3.6.
        eq(users.isShadow, false)
      )
    )
    .orderBy(committedClubSnapshots.rank)
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    qualified: r.classesAttended >= gym.threshold,
  }));
}
