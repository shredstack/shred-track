// Home tab (spec §2.1). Server component. Each card streams independently
// behind its own Suspense boundary so a slow fetcher only delays that one
// card — a transient DB stall on (say) the QuickStats query no longer blocks
// the rest of the page from rendering, and combined with per-fetcher
// try/catch the slow card eventually degrades to nothing rather than hanging
// the whole Vercel function for the full 300s timeout.

import { Suspense } from "react";
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

function CardSkeleton({ height = "h-16" }: { height?: string }) {
  return (
    <div
      className={`${height} w-full animate-pulse rounded-2xl bg-white/[0.04]`}
    />
  );
}

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
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Home</h1>
          <p className="text-sm text-muted-foreground">Your day at a glance.</p>
        </div>
        <TodaysWorkoutCard data={null} />
        <Suspense fallback={<CardSkeleton height="h-20" />}>
          <SoloQuickStats userId={user.id} gymTimezone={gymTimezone} />
        </Suspense>
      </div>
    );
  }

  const cid = activeCommunityId;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Home</h1>
        <p className="text-sm text-muted-foreground">Your day at a glance.</p>
      </div>
      <Suspense fallback={<CardSkeleton />}>
        <GymHeaderAsync communityId={cid} />
      </Suspense>
      <Suspense fallback={null}>
        <PendingDocsAsync userId={user.id} communityId={cid} />
      </Suspense>
      <Suspense fallback={<CardSkeleton />}>
        <TodaysClassAsync userId={user.id} communityId={cid} tz={gymTimezone} />
      </Suspense>
      <Suspense fallback={<CardSkeleton />}>
        <TodaysWorkoutAsync communityId={cid} tz={gymTimezone} />
      </Suspense>
      <Suspense fallback={<CardSkeleton />}>
        <ChallengeAsync userId={user.id} communityId={cid} tz={gymTimezone} />
      </Suspense>
      <Suspense fallback={<CardSkeleton />}>
        <MurphPrepAsync userId={user.id} communityId={cid} tz={gymTimezone} />
      </Suspense>
      <Suspense fallback={<CardSkeleton />}>
        <CommittedClubAsync userId={user.id} communityId={cid} />
      </Suspense>
      <Suspense fallback={<CardSkeleton height="h-24" />}>
        <SocialFeedAsync userId={user.id} communityId={cid} />
      </Suspense>
      <Suspense fallback={<CardSkeleton height="h-20" />}>
        <QuickStatsAsync userId={user.id} communityId={cid} tz={gymTimezone} />
      </Suspense>
    </div>
  );
}

async function GymHeaderAsync({ communityId }: { communityId: string }) {
  const data = await fetchGymHeaderStrip(communityId);
  return <GymHeaderStrip data={data} />;
}

async function PendingDocsAsync({
  userId,
  communityId,
}: {
  userId: string;
  communityId: string;
}) {
  const data = await fetchPendingDocuments(userId, communityId);
  return <PendingDocumentsBanner data={data} />;
}

async function TodaysClassAsync({
  userId,
  communityId,
  tz,
}: {
  userId: string;
  communityId: string;
  tz: string;
}) {
  const data = await fetchTodaysClass(userId, communityId, tz);
  return <TodaysClassCard data={data} />;
}

async function TodaysWorkoutAsync({
  communityId,
  tz,
}: {
  communityId: string;
  tz: string;
}) {
  const data = await fetchTodaysWorkout(communityId, tz);
  return <TodaysWorkoutCard data={data} />;
}

async function ChallengeAsync({
  userId,
  communityId,
  tz,
}: {
  userId: string;
  communityId: string;
  tz: string;
}) {
  const data = await fetchActiveChallenge(userId, communityId, tz);
  return <ChallengeCard data={data} />;
}

async function MurphPrepAsync({
  userId,
  communityId,
  tz,
}: {
  userId: string;
  communityId: string;
  tz: string;
}) {
  const data = await fetchMurphPrep(userId, communityId, tz);
  return <MurphPrepCard data={data} />;
}

async function CommittedClubAsync({
  userId,
  communityId,
}: {
  userId: string;
  communityId: string;
}) {
  const data = await fetchCommittedClub(userId, communityId);
  return <CommittedClubWidget data={data} />;
}

async function SocialFeedAsync({
  userId,
  communityId,
}: {
  userId: string;
  communityId: string;
}) {
  const posts = await fetchSocialFeedTeaser(userId, communityId);
  return <SocialFeedTeaser posts={posts} />;
}

async function QuickStatsAsync({
  userId,
  communityId,
  tz,
}: {
  userId: string;
  communityId: string;
  tz: string;
}) {
  const data = await fetchQuickStats(userId, communityId, tz);
  return <QuickStatsStrip data={data} />;
}

async function SoloQuickStats({
  userId,
  gymTimezone,
}: {
  userId: string;
  gymTimezone: string;
}) {
  const data = await fetchQuickStats(userId, null, gymTimezone);
  return <QuickStatsStrip data={data} />;
}
