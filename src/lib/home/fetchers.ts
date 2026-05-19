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
  gymPosts,
  programmingTrackDays,
  programmingTrackParticipations,
  programmingTracks,
  scores,
  users,
  workouts,
  workoutSections,
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

export async function fetchPendingDocuments(
  userId: string,
  communityId: string
): Promise<PendingDocumentsBannerData | null> {
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
}

export async function fetchGymHeaderStrip(
  communityId: string
): Promise<GymHeaderStripData | null> {
  const [c] = await db
    .select({ name: communities.name, logoUrl: communities.logoUrl })
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
  };
}

export async function fetchTodaysClass(
  userId: string,
  communityId: string,
  gymTimezone: string
): Promise<TodaysClassCardData | null> {
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
}

export async function fetchTodaysWorkout(
  communityId: string,
  gymTimezone: string
): Promise<TodaysWorkoutCardData | null> {
  const today = todayInTz(gymTimezone);
  const [w] = await db
    .select({
      id: workouts.id,
      title: workouts.title,
      description: workouts.description,
    })
    .from(workouts)
    .where(
      and(
        eq(workouts.communityId, communityId),
        eq(workouts.workoutDate, today),
        eq(workouts.published, true)
      )
    )
    .orderBy(desc(workouts.updatedAt))
    .limit(1);
  if (!w) return null;
  // Compose a one-line summary from the first WOD section title or
  // workout description.
  let summary: string | null = w.description ? w.description.slice(0, 100) : null;
  const [wodSection] = await db
    .select({ title: workoutSections.title })
    .from(workoutSections)
    .where(
      and(
        eq(workoutSections.workoutId, w.id),
        eq(workoutSections.kind, "wod")
      )
    )
    .limit(1);
  if (wodSection?.title) summary = wodSection.title;
  return { workoutId: w.id, title: w.title ?? null, summary };
}

export async function fetchActiveChallenge(
  userId: string,
  communityId: string,
  gymTimezone: string
): Promise<ChallengeCardData | null> {
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
  return {
    trackId: track.id,
    name: track.name,
    dayNumber,
    totalDays,
    todayBody: day?.body ?? null,
  };
}

export async function fetchMurphPrep(
  userId: string,
  communityId: string,
  gymTimezone: string
): Promise<MurphPrepCardData | null> {
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
}

export async function fetchCommittedClub(
  userId: string,
  communityId: string
): Promise<CommittedClubWidgetData | null> {
  if (!(await isFlagOn("committed_club", { userId, communityId }))) {
    return null;
  }
  const p = await getCurrentMonthProgress(userId, communityId);
  return {
    classesAttended: p.classesAttended,
    threshold: p.threshold,
    qualified: p.qualified,
  };
}

export async function fetchSocialFeedTeaser(
  userId: string,
  communityId: string
): Promise<SocialFeedTeaserPost[]> {
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
}

export async function fetchQuickStats(
  userId: string,
  communityId: string | null,
  gymTimezone: string
): Promise<QuickStatsStripData> {
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
    const counts = await db
      .select({
        n: sql<number>`count(*)::int`,
      })
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
          gte(classInstances.startAt, yearStartUtc)
        )
      );
    if (counts[0]?.n === 0) {
      return { week: 0, month: 0, year: 0 };
    }
    // Run three queries (cheap on indexed timestamp range).
    const [w, m, y] = await Promise.all([
      countAttended(userId, communityId, weekStartUtc),
      countAttended(userId, communityId, monthStart),
      countAttended(userId, communityId, yearStartUtc),
    ]);
    return { week: w, month: m, year: y };
  }
  const [w, m, y] = await Promise.all([
    countScores(userId, weekStartUtc),
    countScores(userId, monthStart),
    countScores(userId, yearStartUtc),
  ]);
  return { week: w, month: m, year: y };
}

async function countAttended(
  userId: string,
  communityId: string,
  startUtc: Date
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
        gte(classInstances.startAt, startUtc)
      )
    );
  return row?.n ?? 0;
}

async function countScores(userId: string, startUtc: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(scores)
    .where(and(eq(scores.userId, userId), gte(scores.createdAt, startUtc)));
  return row?.n ?? 0;
}
