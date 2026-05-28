// Server-side home page data fetchers (spec §2.1).
//
// Each fetcher reads from the DB and returns either data or null. Cards
// render only when their fetcher returns non-null, so flag-gated cards
// degrade gracefully when:
//  - the feature flag is off
//  - the user is in solo mode (activeCommunityId null)
//  - the gym hasn't created any of the relevant entities yet

import { and, asc, desc, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  classInstances,
  classRegistrations,
  classSchedules,
  communities,
  crossfitWorkouts,
  gymPosts,
  programmingTrackDays,
  programmingTrackParticipations,
  programmingTracks,
  scores,
  users,
  workoutSessions,
} from "@/db/schema";
import { isFlagOn } from "@/lib/feature-flags";
import {
  getCurrentMonthProgress,
  gymMonthBounds,
} from "@/lib/committed-club";
import type { TodaysClassCardData } from "@/components/home/TodaysClassCard";
import type { TodaysWorkoutCardData } from "@/components/home/TodaysWorkoutCard";
import type { ChallengeCardData } from "@/components/home/ChallengeCard";
import type { MurphPrepCardData } from "@/components/home/MurphPrepCard";
import type { CommittedClubWidgetData } from "@/components/home/CommittedClubWidget";
import type { SocialFeedTeaserPost } from "@/components/home/SocialFeedTeaser";
import type { QuickStatsStripData } from "@/components/home/QuickStatsStrip";
import type { GymHeaderStripData } from "@/components/home/GymHeaderStrip";
import type { PendingDocumentsBannerData } from "@/components/home/PendingDocumentsBanner";
import { getPendingDocuments } from "@/lib/documents";

function todayInTz(tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

function startOfTodayUtc(tz: string): Date {
  const today = todayInTz(tz);
  const ms = new Date(`${today}T00:00:00Z`).getTime();
  // Shift by the tz offset to land on local midnight in UTC.
  const offset = tzOffsetMs(tz, new Date(`${today}T00:00:00Z`));
  return new Date(ms - offset);
}

function endOfTodayUtc(tz: string): Date {
  const start = startOfTodayUtc(tz);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

function tzOffsetMs(tz: string, at: Date): number {
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

// Each fetcher swallows its own errors and returns a safe fallback so a single
// stalled query (or transient Supabase outage) can't take down the whole home
// page — combined with per-card Suspense in page.tsx, this means a slow
// fetcher only delays/hides one card instead of blocking the render.
function logFetcherError(label: string, e: unknown) {
  console.error(`[home fetcher ${label}] failed:`, e);
}

export async function fetchPendingDocuments(
  userId: string,
  communityId: string
): Promise<PendingDocumentsBannerData | null> {
  try {
    const pending = await getPendingDocuments(userId, communityId);
    if (pending.length === 0) return null;
    const [c] = await db
      .select({ name: communities.name, slug: communities.inviteUrlSlug })
      .from(communities)
      .where(eq(communities.id, communityId))
      .limit(1);
    if (!c?.slug) return null;
    return {
      slug: c.slug,
      gymName: c.name,
      pendingCount: pending.length,
      anyResign: pending.some((d) => d.isResign),
    };
  } catch (e) {
    logFetcherError("fetchPendingDocuments", e);
    return null;
  }
}

export async function fetchGymHeaderStrip(
  communityId: string
): Promise<GymHeaderStripData | null> {
  try {
    const [c] = await db
      .select({
        name: communities.name,
        logoUrl: communities.logoUrl,
        websiteUrl: communities.websiteUrl,
      })
      .from(communities)
      .where(eq(communities.id, communityId))
      .limit(1);
    if (!c) return null;
    // Pinned announcement: latest published pinned gym_post for the gym.
    const [pinned] = await db
      .select({ body: gymPosts.body })
      .from(gymPosts)
      .where(
        and(
          eq(gymPosts.communityId, communityId),
          eq(gymPosts.status, "published"),
          eq(gymPosts.isPinned, true)
        )
      )
      .orderBy(desc(gymPosts.publishedAt))
      .limit(1);
    return {
      name: c.name,
      logoUrl: c.logoUrl ?? null,
      pinnedAnnouncement: pinned?.body ?? null,
      websiteUrl: c.websiteUrl ?? null,
    };
  } catch (e) {
    logFetcherError("fetchGymHeaderStrip", e);
    return null;
  }
}

export async function fetchTodaysClass(
  userId: string,
  communityId: string,
  gymTimezone: string
): Promise<TodaysClassCardData | null> {
  try {
    if (!(await isFlagOn("classes", { userId, communityId }))) return null;
    const startUtc = startOfTodayUtc(gymTimezone);
    const endUtc = endOfTodayUtc(gymTimezone);
    // Show the next class today the member is registered for.
    const [row] = await db
      .select({
        classInstanceId: classInstances.id,
        scheduleId: classInstances.scheduleId,
        startAt: classInstances.startAt,
        eventTitle: classInstances.eventTitle,
        coachId: classInstances.coachId,
        scheduleName: classSchedules.name,
      })
      .from(classRegistrations)
      .innerJoin(
        classInstances,
        eq(classInstances.id, classRegistrations.classInstanceId)
      )
      .leftJoin(classSchedules, eq(classSchedules.id, classInstances.scheduleId))
      .where(
        and(
          eq(classRegistrations.userId, userId),
          eq(classRegistrations.status, "registered"),
          eq(classInstances.communityId, communityId),
          eq(classInstances.status, "scheduled"),
          gte(classInstances.startAt, startUtc),
          lt(classInstances.startAt, endUtc)
        )
      )
      .orderBy(asc(classInstances.startAt))
      .limit(1);
    if (!row) return null;
    let coachName: string | null = null;
    if (row.coachId) {
      const [c] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, row.coachId))
        .limit(1);
      coachName = c?.name ?? null;
    }
    return {
      classInstanceId: row.classInstanceId,
      name: row.eventTitle ?? row.scheduleName ?? "Class",
      startAt: row.startAt.toISOString(),
      coachName,
    };
  } catch (e) {
    logFetcherError("fetchTodaysClass", e);
    return null;
  }
}

export async function fetchTodaysWorkout(
  communityId: string,
  gymTimezone: string
): Promise<TodaysWorkoutCardData | null> {
  try {
    const today = todayInTz(gymTimezone);
    // Prefer a WOD-kind session; fall back to position 0 if none. The
    // session.id stands in for the legacy workouts.id (day-level handle).
    const [s] = await db
      .select({
        id: workoutSessions.id,
        sessionTitle: workoutSessions.title,
        templateTitle: crossfitWorkouts.title,
        templateDescription: crossfitWorkouts.description,
        kind: workoutSessions.kind,
      })
      .from(workoutSessions)
      .leftJoin(
        crossfitWorkouts,
        eq(crossfitWorkouts.id, workoutSessions.crossfitWorkoutId)
      )
      .where(
        and(
          eq(workoutSessions.communityId, communityId),
          eq(workoutSessions.workoutDate, today),
          eq(workoutSessions.published, true)
        )
      )
      .orderBy(
        desc(eq(workoutSessions.kind, "wod")),
        asc(workoutSessions.position)
      )
      .limit(1);
    if (!s) return null;
    const summary = s.templateDescription
      ? s.templateDescription.slice(0, 100)
      : s.templateTitle ?? null;
    return {
      workoutId: s.id,
      title: s.sessionTitle ?? s.templateTitle ?? null,
      summary,
    };
  } catch (e) {
    logFetcherError("fetchTodaysWorkout", e);
    return null;
  }
}

export async function fetchActiveChallenge(
  userId: string,
  communityId: string,
  gymTimezone: string
): Promise<ChallengeCardData | null> {
  try {
  if (
    !(await isFlagOn("programming_tracks", { userId, communityId }))
  ) {
    return null;
  }
  const today = todayInTz(gymTimezone);
  const [track] = await db
    .select({
      id: programmingTracks.id,
      name: programmingTracks.name,
      startsOn: programmingTracks.startsOn,
      endsOn: programmingTracks.endsOn,
      scoringConfig: programmingTracks.scoringConfig,
    })
    .from(programmingTracks)
    .where(
      and(
        eq(programmingTracks.communityId, communityId),
        eq(programmingTracks.kind, "monthly_challenge"),
        eq(programmingTracks.status, "active"),
        lte(programmingTracks.startsOn, today),
        gte(programmingTracks.endsOn, today)
      )
    )
    .limit(1);
  if (!track) return null;
  const [day] = await db
    .select({ body: programmingTrackDays.body })
    .from(programmingTrackDays)
    .where(
      and(
        eq(programmingTrackDays.trackId, track.id),
        eq(programmingTrackDays.date, today)
      )
    )
    .limit(1);
  const start = new Date(`${track.startsOn}T00:00:00Z`).getTime();
  const todayMs = new Date(`${today}T00:00:00Z`).getTime();
  const end = new Date(`${track.endsOn}T00:00:00Z`).getTime();
  const dayNumber = Math.floor((todayMs - start) / 86_400_000) + 1;
  const totalDays = Math.floor((end - start) / 86_400_000) + 1;

  // Cumulative rollup — only when the track has scoring configured. The
  // sum aggregates across all of this user's `track_day_scores` rows on
  // any day of the track.
  let rollup: ChallengeCardData["rollup"] = null;
  const config = (track.scoringConfig ?? null) as {
    unit?: string;
    unitLabel?: string;
  } | null;
  if (config && config.unit) {
    const { trackDayScores } = await import("@/db/schema");
    const [agg] = await db
      .select({
        sum: sql<string | null>`sum(${trackDayScores.numericValue})`,
        daysLogged: sql<number>`count(*)::int`,
      })
      .from(trackDayScores)
      .innerJoin(
        programmingTrackDays,
        eq(trackDayScores.trackDayId, programmingTrackDays.id)
      )
      .where(
        and(
          eq(programmingTrackDays.trackId, track.id),
          eq(trackDayScores.userId, userId)
        )
      );
    const sum = agg?.sum != null ? Number(agg.sum) : 0;
    if (sum > 0 || (agg?.daysLogged ?? 0) > 0) {
      const unitLabel =
        config.unit === "custom"
          ? config.unitLabel ?? "units"
          : config.unit;
      rollup = {
        sum,
        unitLabel,
        daysLogged: agg?.daysLogged ?? 0,
      };
    }
  }

  return {
    trackId: track.id,
    name: track.name,
    dayNumber,
    totalDays,
    todayBody: day?.body ?? null,
    rollup,
  };
  } catch (e) {
    logFetcherError("fetchActiveChallenge", e);
    return null;
  }
}

export async function fetchMurphPrep(
  userId: string,
  communityId: string,
  gymTimezone: string
): Promise<MurphPrepCardData | null> {
  try {
  if (!(await isFlagOn("programming_tracks", { userId, communityId }))) {
    return null;
  }
  const today = todayInTz(gymTimezone);
  const [track] = await db
    .select({
      id: programmingTracks.id,
      name: programmingTracks.name,
      startsOn: programmingTracks.startsOn,
      endsOn: programmingTracks.endsOn,
      displayMode: programmingTracks.displayMode,
    })
    .from(programmingTracks)
    .where(
      and(
        eq(programmingTracks.communityId, communityId),
        eq(programmingTracks.kind, "event_prep"),
        eq(programmingTracks.status, "active"),
        lte(programmingTracks.startsOn, today),
        gte(programmingTracks.endsOn, today)
      )
    )
    .limit(1);
  if (!track) return null;
  // Only surface standalone tracks here — inline tracks render in the WOD view.
  if (
    track.displayMode !== "standalone" &&
    track.displayMode !== "inline_and_standalone"
  ) {
    return null;
  }
  const [participation] = await db
    .select({ id: programmingTrackParticipations.id })
    .from(programmingTrackParticipations)
    .where(
      and(
        eq(programmingTrackParticipations.trackId, track.id),
        eq(programmingTrackParticipations.userId, userId),
        isNull(programmingTrackParticipations.leftAt)
      )
    )
    .limit(1);
  const start = new Date(`${track.startsOn}T00:00:00Z`).getTime();
  const todayMs = new Date(`${today}T00:00:00Z`).getTime();
  const end = new Date(`${track.endsOn}T00:00:00Z`).getTime();
  const dayNumber = Math.floor((todayMs - start) / 86_400_000) + 1;
  const totalDays = Math.floor((end - start) / 86_400_000) + 1;
  let todayBody: string | null = null;
  if (participation) {
    const [day] = await db
      .select({ body: programmingTrackDays.body })
      .from(programmingTrackDays)
      .where(
        and(
          eq(programmingTrackDays.trackId, track.id),
          eq(programmingTrackDays.date, today)
        )
      )
      .limit(1);
    todayBody = day?.body ?? null;
  }
  return {
    trackId: track.id,
    name: track.name,
    dayNumber: participation ? dayNumber : null,
    totalDays,
    joined: !!participation,
    todayBody,
  };
  } catch (e) {
    logFetcherError("fetchMurphPrep", e);
    return null;
  }
}

export async function fetchCommittedClub(
  userId: string,
  communityId: string
): Promise<CommittedClubWidgetData | null> {
  try {
    if (!(await isFlagOn("committed_club", { userId, communityId }))) {
      return null;
    }
    const p = await getCurrentMonthProgress(userId, communityId);
    return {
      classesAttended: p.classesAttended,
      threshold: p.threshold,
      qualified: p.qualified,
    };
  } catch (e) {
    logFetcherError("fetchCommittedClub", e);
    return null;
  }
}

export async function fetchSocialFeedTeaser(
  userId: string,
  communityId: string
): Promise<SocialFeedTeaserPost[]> {
  try {
    if (!(await isFlagOn("social_feed", { userId, communityId }))) return [];
    const rows = await db
      .select({
        id: gymPosts.id,
        kind: gymPosts.kind,
        body: gymPosts.body,
        publishedAt: gymPosts.publishedAt,
        authorName: users.name,
      })
      .from(gymPosts)
      .innerJoin(users, eq(users.id, gymPosts.authorId))
      .where(
        and(
          eq(gymPosts.communityId, communityId),
          eq(gymPosts.status, "published")
        )
      )
      .orderBy(desc(gymPosts.publishedAt))
      .limit(3);
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      authorName: r.authorName,
      body: r.body,
      publishedAt: r.publishedAt.toISOString(),
    }));
  } catch (e) {
    logFetcherError("fetchSocialFeedTeaser", e);
    return [];
  }
}

export async function fetchQuickStats(
  userId: string,
  communityId: string | null,
  gymTimezone: string
): Promise<QuickStatsStripData> {
  try {
    // For gym members: counts of attended class_registrations in week/month/year.
    // For solo: counts of scores logged in week/month/year.
    const now = new Date();
    const { startUtc: monthStart } = gymMonthBounds(gymTimezone, now);
    const yearStartUtc = new Date(
      new Date(monthStart).getUTCFullYear(),
      0,
      1
    );
    // Week-start = monday of current week (gym-local). Approximate: subtract
    // ((today.getUTCDay()+6) % 7) days from today's gym-local start.
    const todayStartUtc = startOfTodayUtc(gymTimezone);
    const dow = (todayStartUtc.getUTCDay() + 6) % 7;
    const weekStartUtc = new Date(todayStartUtc.getTime() - dow * 86_400_000);

    if (communityId) {
      const [allTime, w, m, y] = await Promise.all([
        countAttended(userId, communityId, null),
        countAttended(userId, communityId, weekStartUtc),
        countAttended(userId, communityId, monthStart),
        countAttended(userId, communityId, yearStartUtc),
      ]);
      return { week: w, month: m, year: y, allTime };
    }
    const [allTime, w, m, y] = await Promise.all([
      countScores(userId, null),
      countScores(userId, weekStartUtc),
      countScores(userId, monthStart),
      countScores(userId, yearStartUtc),
    ]);
    return { week: w, month: m, year: y, allTime };
  } catch (e) {
    logFetcherError("fetchQuickStats", e);
    return { week: 0, month: 0, year: 0, allTime: 0 };
  }
}

async function countAttended(
  userId: string,
  communityId: string,
  startUtc: Date | null
): Promise<number> {
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
        ...(startUtc ? [gte(classInstances.startAt, startUtc)] : [])
      )
    );
  return row?.n ?? 0;
}

async function countScores(userId: string, startUtc: Date | null): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(scores)
    .where(
      and(
        eq(scores.userId, userId),
        ...(startUtc ? [gte(scores.createdAt, startUtc)] : [])
      )
    );
  return row?.n ?? 0;
}
