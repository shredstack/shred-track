// Home tab (spec §2.1). Server component. Fetches in parallel and renders
// cards based on what data resolves. Flag-gated cards no-op when the
// feature is off, the user is in solo mode, or the gym hasn't created the
// underlying entity yet — so solo users see a coherent "today's workout +
// quick stats" view without empty placeholders.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { communities, users } from "@/db/schema";
import { getSessionUser } from "@/lib/session";
import { DEFAULT_GYM_TIMEZONE, resolveGymTimezone } from "@/lib/timezone";
import {
  fetchActiveChallenge,
  fetchCommittedClub,
  fetchGymHeaderStrip,
  fetchMurphPrep,
  fetchPendingDocuments,
  fetchQuickStats,
  fetchSocialFeedTeaser,
  fetchTodaysClass,
  fetchTodaysWorkout,
} from "@/lib/home/fetchers";
import { TodaysClassCard } from "@/components/home/TodaysClassCard";
import { TodaysWorkoutCard } from "@/components/home/TodaysWorkoutCard";
import { ChallengeCard } from "@/components/home/ChallengeCard";
import { MurphPrepCard } from "@/components/home/MurphPrepCard";
import { CommittedClubWidget } from "@/components/home/CommittedClubWidget";
import { SocialFeedTeaser } from "@/components/home/SocialFeedTeaser";
import { QuickStatsStrip } from "@/components/home/QuickStatsStrip";
import { GymHeaderStrip } from "@/components/home/GymHeaderStrip";
import { PendingDocumentsBanner } from "@/components/home/PendingDocumentsBanner";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getSessionUser();
  if (!user) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Home</h1>
        <p className="text-sm text-muted-foreground">Please sign in.</p>
      </div>
    );
  }

  const [u] = await db
    .select({ activeCommunityId: users.activeCommunityId })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  const activeCommunityId = u?.activeCommunityId ?? null;

  let gymTimezone = DEFAULT_GYM_TIMEZONE;
  if (activeCommunityId) {
    const [c] = await db
      .select({ tz: communities.gymTimezone })
      .from(communities)
      .where(eq(communities.id, activeCommunityId))
      .limit(1);
    if (c) gymTimezone = resolveGymTimezone(c.tz);
  }

  // Solo mode — no gym-scoped cards.
  if (!activeCommunityId) {
    const quickStats = await fetchQuickStats(user.id, null, gymTimezone);
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Home</h1>
          <p className="text-sm text-muted-foreground">Your day at a glance.</p>
        </div>
        <TodaysWorkoutCard data={null} />
        <QuickStatsStrip data={quickStats} />
      </div>
    );
  }

  const [
    header,
    pendingDocs,
    todaysClass,
    todaysWorkout,
    challenge,
    murph,
    committedClub,
    socialPosts,
    quickStats,
  ] = await Promise.all([
    fetchGymHeaderStrip(activeCommunityId),
    fetchPendingDocuments(user.id, activeCommunityId),
    fetchTodaysClass(user.id, activeCommunityId, gymTimezone),
    fetchTodaysWorkout(activeCommunityId, gymTimezone),
    fetchActiveChallenge(user.id, activeCommunityId, gymTimezone),
    fetchMurphPrep(user.id, activeCommunityId, gymTimezone),
    fetchCommittedClub(user.id, activeCommunityId),
    fetchSocialFeedTeaser(user.id, activeCommunityId),
    fetchQuickStats(user.id, activeCommunityId, gymTimezone),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Home</h1>
        <p className="text-sm text-muted-foreground">Your day at a glance.</p>
      </div>
      <GymHeaderStrip data={header} />
      <PendingDocumentsBanner data={pendingDocs} />
      <TodaysClassCard data={todaysClass} />
      <TodaysWorkoutCard data={todaysWorkout} />
      <ChallengeCard data={challenge} />
      <MurphPrepCard data={murph} />
      <CommittedClubWidget data={committedClub} />
      <SocialFeedTeaser posts={socialPosts} />
      <QuickStatsStrip data={quickStats} />
    </div>
  );
}
